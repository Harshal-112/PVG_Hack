"""Authentication routes: Email OTP, Google OAuth, session introspection, and logout.

Routes:
- POST /auth/email/send-otp
- POST /auth/email/verify-otp
- GET  /auth/google/login
- GET  /auth/google/callback
- POST /auth/google/verify-token
- GET  /auth/me
- POST /auth/logout
"""

from datetime import datetime, timezone
import logging
from typing import Optional

from fastapi import APIRouter, Cookie, Header, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, EmailStr, Field

from app.config import settings
from app.services.auth_service import AuthError, auth_service

logger = logging.getLogger("flashseat.auth_routes")

router = APIRouter(prefix="/auth", tags=["auth"])


# -----------------------------------------------------------------------------
# Request & Response Models
# -----------------------------------------------------------------------------
class SendOtpRequest(BaseModel):
    email: str = Field(..., description="User email address to send verification code to")


class SendOtpResponse(BaseModel):
    ok: bool = True
    challenge_id: str
    email: str
    expires_in_seconds: int
    cooldown_seconds: int
    message: str


class VerifyOtpRequest(BaseModel):
    challenge_id: str = Field(..., min_length=1, description="Challenge ID returned by send-otp")
    email: str = Field(..., description="User email address")
    otp: str = Field(..., min_length=4, max_length=8, description="Verification code received in email")


class UserProfile(BaseModel):
    id: str
    email: str
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    provider: str
    is_verified: bool = True


class AuthResponse(BaseModel):
    ok: bool = True
    session_token: str
    user: UserProfile
    expires_at: Optional[str] = None


class GoogleVerifyTokenRequest(BaseModel):
    credential: str = Field(..., description="Google ID Token JWT")


class AuthMeResponse(BaseModel):
    authenticated: bool
    user: Optional[UserProfile] = None


class LogoutResponse(BaseModel):
    ok: bool = True
    message: str


# Helper to attach secure session cookie
def set_auth_cookie(response: Response, token: str) -> None:
    cookie_name = getattr(settings, "SESSION_COOKIE_NAME", "flashseat_session")
    ttl = getattr(settings, "SESSION_TTL_SECONDS", 604800)
    secure = getattr(settings, "SESSION_COOKIE_SECURE", False)

    response.set_cookie(
        key=cookie_name,
        value=token,
        max_age=ttl,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )


def extract_session_token(
    request: Request,
    authorization: Optional[str] = None,
    cookie_token: Optional[str] = None,
) -> Optional[str]:
    """Extract session token from Authorization: Bearer <token> header or session cookie."""
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
        if token:
            return token
    if cookie_token:
        return cookie_token.strip()
    cookie_name = getattr(settings, "SESSION_COOKIE_NAME", "flashseat_session")
    token_from_request = request.cookies.get(cookie_name)
    if token_from_request:
        return token_from_request.strip()
    return None


# -----------------------------------------------------------------------------
# 1. Manual Email OTP: Send Code
# -----------------------------------------------------------------------------
@router.post("/email/send-otp", response_model=SendOtpResponse)
async def send_email_otp(req: SendOtpRequest):
    """Initiates manual email OTP verification flow.
    
    Generates a cryptographically secure 6-digit code, stores only the salted hash,
    and sends the code via the configured email provider.
    """
    try:
        result = await auth_service.request_email_otp(req.email)
        return JSONResponse(status_code=200, content=result)
    except AuthError as exc:
        content = {"error": exc.code, "message": exc.message}
        content.update(exc.extra)
        return JSONResponse(status_code=exc.status_code, content=content)
    except Exception as exc:
        logger.error(f"Unexpected error in send_email_otp: {exc}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={"error": "INTERNAL_ERROR", "message": "Failed to send verification code. Please try again."},
        )


# -----------------------------------------------------------------------------
# 2. Manual Email OTP: Verify Code
# -----------------------------------------------------------------------------
@router.post("/email/verify-otp", response_model=AuthResponse)
async def verify_email_otp(req: VerifyOtpRequest):
    """Verifies received OTP, enforces rate limits and expiration, and establishes an authenticated session."""
    try:
        result = await auth_service.verify_email_otp(req.challenge_id, req.email, req.otp)
        resp = JSONResponse(status_code=200, content=result)
        set_auth_cookie(resp, result["session_token"])
        return resp
    except AuthError as exc:
        content = {"error": exc.code, "message": exc.message}
        content.update(exc.extra)
        return JSONResponse(status_code=exc.status_code, content=content)
    except Exception as exc:
        logger.error(f"Unexpected error in verify_email_otp: {exc}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={"error": "INTERNAL_ERROR", "message": "Failed to verify code. Please try again."},
        )


# -----------------------------------------------------------------------------
# 3. Google OAuth 2.0: Login Redirect
# -----------------------------------------------------------------------------
@router.get("/google/login")
async def google_login(
    redirect_uri: Optional[str] = Query(None),
    mode: Optional[str] = Query("redirect", description="'redirect' or 'json'"),
):
    """Initiates Google OAuth 2.0 flow with state protection."""
    auth_url, state = auth_service.get_google_auth_url(redirect_uri=redirect_uri)
    if mode == "json":
        return {"auth_url": auth_url, "state": state}
    return RedirectResponse(url=auth_url, status_code=307)


# -----------------------------------------------------------------------------
# 4. Google OAuth 2.0: Callback Handler
# -----------------------------------------------------------------------------
@router.get("/google/callback")
async def google_callback(
    code: str = Query(...),
    state: Optional[str] = Query(None),
    response: Response = None,
):
    """Receives authorization code from Google, verifies tokens on server, and creates user session."""
    try:
        r_uri = getattr(settings, "GOOGLE_REDIRECT_URI", "http://localhost:8000/api/v1/auth/google/callback")
        token_data = await auth_service.exchange_google_code(code, redirect_uri=r_uri)
        id_token = token_data.get("id_token")
        if not id_token:
            raise AuthError("MISSING_ID_TOKEN", "Google did not return an ID token.", 400)

        result = await auth_service.handle_google_sign_in(id_token)
        redirect = RedirectResponse(url="/ui/?login=success", status_code=303)
        set_auth_cookie(redirect, result["session_token"])
        return redirect
    except AuthError as exc:
        return JSONResponse(status_code=exc.status_code, content={"error": exc.code, "message": exc.message})
    except Exception as exc:
        logger.error(f"Unexpected error in google_callback: {exc}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={"error": "INTERNAL_ERROR", "message": "Failed to complete Google authentication."},
        )


# -----------------------------------------------------------------------------
# 5. Google Sign-In SDK Token Verification (One Tap / Google Button)
# -----------------------------------------------------------------------------
@router.post("/google/verify-token", response_model=AuthResponse)
async def google_verify_token(req: GoogleVerifyTokenRequest):
    """Verifies Google ID token from frontend Google Sign-In button / One Tap dialog."""
    try:
        result = await auth_service.handle_google_sign_in(req.credential)
        resp = JSONResponse(status_code=200, content=result)
        set_auth_cookie(resp, result["session_token"])
        return resp
    except AuthError as exc:
        return JSONResponse(status_code=exc.status_code, content={"error": exc.code, "message": exc.message})
    except Exception as exc:
        logger.error(f"Unexpected error in google_verify_token: {exc}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={"error": "INTERNAL_ERROR", "message": "Failed to verify Google token."},
        )


# -----------------------------------------------------------------------------
# 6. Session Introspection (/auth/me)
# -----------------------------------------------------------------------------
@router.get("/me", response_model=AuthMeResponse)
async def get_current_user_info(
    request: Request,
    authorization: Optional[str] = Header(None),
    flashseat_session: Optional[str] = Cookie(None),
):
    """Returns currently authenticated user from session token."""
    token = extract_session_token(request, authorization, flashseat_session)
    if not token:
        return {"authenticated": False, "user": None}

    session_data = await auth_service.get_session(token)
    if not session_data:
        return {"authenticated": False, "user": None}

    user = session_data["user"]
    return {
        "authenticated": True,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "display_name": user.get("display_name"),
            "avatar_url": user.get("avatar_url"),
            "provider": user.get("provider", "unknown"),
            "is_verified": user.get("is_verified", True),
        },
    }


# -----------------------------------------------------------------------------
# 7. Logout
# -----------------------------------------------------------------------------
@router.post("/logout", response_model=LogoutResponse)
async def logout_user(
    request: Request,
    authorization: Optional[str] = Header(None),
    flashseat_session: Optional[str] = Cookie(None),
):
    """Invalidates session and clears session cookie."""
    token = extract_session_token(request, authorization, flashseat_session)
    if token:
        await auth_service.invalidate_session(token)

    cookie_name = getattr(settings, "SESSION_COOKIE_NAME", "flashseat_session")
    resp = JSONResponse(status_code=200, content={"ok": True, "message": "Logged out successfully."})
    resp.delete_cookie(key=cookie_name, path="/")
    return resp
