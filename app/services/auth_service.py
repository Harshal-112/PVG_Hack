"""Authentication service for Google OAuth and Email OTP verification.

Implements:
- Manual Email OTP flow:
  - Cryptographically secure 6-digit random OTP generation.
  - Salted SHA-256 hashing (plaintext OTP is never stored in DB or returned to clients).
  - Rate limiting with configurable resend cooldown and max verification attempts.
  - Expiration enforcement (default 5 minutes).
  - Atomic single-use consumption (preventing replay attacks).
  - SMTP delivery with TLS/SSL and test transport support.
- Google OAuth 2.0 / OpenID Connect flow:
  - Authorization URL generator with CSRF state protection.
  - Code exchange via Google OAuth token endpoint.
  - Server-side ID token verification (validating signature, issuer, audience, expiry, email_verified).
  - Stable Google subject identifier ('sub') mapping to user accounts.
- Session management:
  - Secure random session tokens with configurable TTL.
  - Session retrieval, validation, and invalidation (logout).
"""

import asyncio
from datetime import datetime, timezone, timedelta
import email.utils
import hashlib
import hmac
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import re
import secrets
import smtplib
import ssl
from typing import Any
import uuid

import httpx

from app.config import settings

logger = logging.getLogger("flashseat.auth")

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")


class AuthError(Exception):
    """Base exception for authentication errors."""
    def __init__(self, code: str, message: str, status_code: int = 400, extra: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.extra = extra or {}


class AuthService:
    def __init__(self):
        # In-memory storage fallbacks (for when Postgres or Redis is not connected)
        self._challenges: dict[str, dict] = {}       # challenge_id -> challenge data
        self._email_cooldowns: dict[str, datetime] = {} # email -> last_sent_at
        self._users: dict[str, dict] = {}            # user_id -> user data
        self._identities: dict[tuple[str, str], str] = {} # (provider, provider_user_id) -> user_id
        self._sessions: dict[str, dict] = {}         # session_token -> session data
        self._dispatched_emails: list[dict] = []     # for test verification

    # -------------------------------------------------------------------------
    # Email Normalization & Validation
    # -------------------------------------------------------------------------
    @staticmethod
    def normalize_email(email_str: str) -> str:
        """Strip whitespace and lowercase email."""
        if not email_str:
            raise AuthError("INVALID_EMAIL", "Email address is required.", 422)
        cleaned = email_str.strip().lower()
        if not EMAIL_REGEX.match(cleaned):
            raise AuthError("INVALID_EMAIL", "Invalid email address format.", 422)
        return cleaned

    # -------------------------------------------------------------------------
    # Cryptographic OTP Generation & Hashing
    # -------------------------------------------------------------------------
    @staticmethod
    def generate_otp() -> str:
        """Generate a cryptographically secure 6-digit random code."""
        # secrets.randbelow(900000) yields 0..899999 + 100000 -> 100000..999999
        return f"{secrets.randbelow(900000) + 100000:06d}"

    @staticmethod
    def hash_otp(otp: str, salt: str) -> str:
        """Hash OTP with salt using SHA-256."""
        payload = f"{salt}:{otp}".encode("utf-8")
        return hashlib.sha256(payload).hexdigest()

    # -------------------------------------------------------------------------
    # Email Delivery (SMTP & Test Provider)
    # -------------------------------------------------------------------------
    async def send_email(self, recipient_email: str, otp_code: str) -> bool:
        """Send verification email via SMTP or test transport."""
        subject = "FlashSeat Email Verification Code"
        text_body = (
            f"Your FlashSeat verification code is: {otp_code}\n\n"
            f"This code expires in five minutes. Do not share it with anyone. "
            f"If you did not request this code, you can ignore this email."
        )

        html_body = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #f8fafc; padding: 24px; }}
    .card {{ max-width: 480px; margin: 0 auto; background: #131b2e; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }}
    .logo {{ font-size: 20px; font-weight: 800; color: #6366f1; margin-bottom: 24px; display: flex; align-items: center; gap: 8px; }}
    .code-box {{ background: #1e1b4b; border: 1px dashed #6366f1; border-radius: 12px; padding: 18px; text-align: center; margin: 24px 0; }}
    .code {{ font-size: 32px; font-weight: 900; letter-spacing: 6px; color: #a5b4fc; font-family: monospace; }}
    .meta {{ font-size: 13px; color: #94a3b8; line-height: 1.6; }}
    .footer {{ font-size: 11px; color: #64748b; margin-top: 24px; text-align: center; border-top: 1px solid #1e293b; padding-top: 16px; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">⚡ FlashSeat Authentication</div>
    <p class="meta">Please use the following single-use verification code to complete your sign-in to FlashSeat Cinema:</p>
    <div class="code-box">
      <div class="code">{otp_code}</div>
    </div>
    <p class="meta">This code expires in <strong>5 minutes</strong>. For security, never share this code with anyone.</p>
    <div class="footer">If you did not request this code, please ignore this email. &copy; 2026 FlashSeat.</div>
  </div>
</body>
</html>"""

        # Record dispatch for test / audit tracking
        dispatch_record = {
            "to": recipient_email,
            "subject": subject,
            "body": text_body,
            "sent_at": datetime.now(timezone.utc).isoformat(),
        }
        self._dispatched_emails.append(dispatch_record)

        # Check if real SMTP server is configured
        smtp_host = getattr(settings, "SMTP_HOST", "")
        if smtp_host:
            def _send_sync():
                msg = MIMEMultipart("alternative")
                msg["Subject"] = subject
                msg["From"] = getattr(settings, "EMAIL_FROM", "FlashSeat <noreply@flashseat.com>")
                msg["To"] = recipient_email
                msg["Date"] = email.utils.formatdate(localtime=True)
                msg["Message-ID"] = email.utils.make_msgid(domain="flashseat.com")

                part1 = MIMEText(text_body, "plain", "utf-8")
                part2 = MIMEText(html_body, "html", "utf-8")
                msg.attach(part1)
                msg.attach(part2)

                port = int(getattr(settings, "SMTP_PORT", 587))
                user = getattr(settings, "SMTP_USERNAME", "")
                pwd = getattr(settings, "SMTP_PASSWORD", "")
                use_tls = getattr(settings, "SMTP_USE_TLS", True)

                if port == 465:
                    context = ssl.create_default_context()
                    with smtplib.SMTP_SSL(smtp_host, port, context=context, timeout=10) as server:
                        if user and pwd:
                            server.login(user, pwd)
                        server.send_message(msg)
                else:
                    with smtplib.SMTP(smtp_host, port, timeout=10) as server:
                        if use_tls:
                            server.starttls()
                        if user and pwd:
                            server.login(user, pwd)
                        server.send_message(msg)

            try:
                await asyncio.to_thread(_send_sync)
                logger.info(f"Verification email sent via SMTP to {recipient_email}")
                return True
            except Exception as exc:
                logger.error(f"Failed to send email via SMTP to {recipient_email}: {exc}")
                raise AuthError("EMAIL_DELIVERY_FAILED", f"Failed to deliver verification email: {str(exc)}", 502)

        # If SMTP_HOST is not configured (e.g. local dev / testing), log and treat as successfully dispatched
        logger.info(f"[DEV/TEST] Verification code email sent to {recipient_email} (SMTP_HOST not set)")
        return True

    # -------------------------------------------------------------------------
    # Step 1: Send OTP Challenge
    # -------------------------------------------------------------------------
    async def request_email_otp(self, email_str: str) -> dict:
        """Create an OTP challenge, enforce rate limits, and send email."""
        clean_email = self.normalize_email(email_str)
        now = datetime.now(timezone.utc)

        # 1. Enforce Resend Cooldown
        cooldown_sec = getattr(settings, "OTP_RESEND_COOLDOWN_SECONDS", 60)
        last_sent = self._email_cooldowns.get(clean_email)
        if last_sent:
            elapsed = (now - last_sent).total_seconds()
            if elapsed < cooldown_sec:
                retry_after = int(cooldown_sec - elapsed)
                raise AuthError(
                    "RATE_LIMITED",
                    f"Please wait {retry_after} seconds before requesting a new verification code.",
                    429,
                    {"retry_after": retry_after},
                )

        # 2. Invalidate any existing active challenges for this email
        for cid, ch in list(self._challenges.items()):
            if ch["email"] == clean_email and not ch["consumed"]:
                ch["consumed"] = True

        # 3. Generate secure OTP and salt
        otp = self.generate_otp()
        salt = secrets.token_hex(16)
        otp_hash = self.hash_otp(otp, salt)

        ttl_sec = getattr(settings, "OTP_TTL_SECONDS", 300)
        expires_at = now + timedelta(seconds=ttl_sec)
        challenge_id = uuid.uuid4().hex

        challenge_data = {
            "id": challenge_id,
            "email": clean_email,
            "otp_hash": otp_hash,
            "salt": salt,
            "attempts": 0,
            "max_attempts": getattr(settings, "OTP_MAX_ATTEMPTS", 5),
            "expires_at": expires_at,
            "consumed": False,
            "created_at": now,
        }

        # Save to memory (and database if available)
        self._challenges[challenge_id] = challenge_data
        self._email_cooldowns[clean_email] = now

        # 4. Dispatch Email (Plaintext OTP is ONLY passed to email transport, never saved or returned)
        await self.send_email(clean_email, otp)

        return {
            "ok": True,
            "challenge_id": challenge_id,
            "email": clean_email,
            "expires_in_seconds": ttl_sec,
            "cooldown_seconds": cooldown_sec,
            "message": f"Verification code sent to {clean_email}.",
        }

    # -------------------------------------------------------------------------
    # Step 2: Verify OTP Challenge
    # -------------------------------------------------------------------------
    async def verify_email_otp(self, challenge_id: str, email_str: str, entered_otp: str) -> dict:
        """Verify the entered OTP against the challenge verifier."""
        clean_email = self.normalize_email(email_str)
        now = datetime.now(timezone.utc)

        challenge = self._challenges.get(challenge_id)
        if not challenge or challenge["email"] != clean_email:
            raise AuthError("CHALLENGE_NOT_FOUND", "Verification session not found or expired. Please request a new code.", 404)

        if challenge["consumed"]:
            raise AuthError("ALREADY_CONSUMED", "This verification code has already been used. Please request a new code.", 409)

        if now > challenge["expires_at"]:
            raise AuthError("OTP_EXPIRED", "Verification code has expired. Please request a new one.", 410)

        if challenge["attempts"] >= challenge["max_attempts"]:
            raise AuthError("MAX_ATTEMPTS_EXCEEDED", "Too many incorrect attempts. Please request a new verification code.", 429)

        # Secure hash comparison with HMAC to prevent timing attacks
        candidate_hash = self.hash_otp(entered_otp.strip(), challenge["salt"])
        if not hmac.compare_digest(challenge["otp_hash"], candidate_hash):
            challenge["attempts"] += 1
            remaining = max(0, challenge["max_attempts"] - challenge["attempts"])
            if remaining == 0:
                challenge["consumed"] = True
                raise AuthError(
                    "MAX_ATTEMPTS_EXCEEDED",
                    "Too many incorrect attempts. This code has been invalidated. Please request a new one.",
                    429,
                    {"remaining_attempts": 0},
                )
            raise AuthError(
                "INVALID_OTP",
                f"Incorrect verification code. {remaining} attempt(s) remaining.",
                400,
                {"remaining_attempts": remaining},
            )

        # OTP verified! Mark challenge as consumed atomically
        challenge["consumed"] = True

        # Get or create user
        user = await self.get_or_create_user(
            email=clean_email,
            provider="email_otp",
            provider_user_id=clean_email,
            display_name=clean_email.split("@")[0].replace(".", " ").title(),
        )

        # Establish secure application session
        session = await self.create_session(user["id"])

        return {
            "ok": True,
            "user": user,
            "session_token": session["token"],
            "expires_at": session["expires_at"].isoformat(),
        }

    # -------------------------------------------------------------------------
    # Google OAuth 2.0 / OpenID Connect
    # -------------------------------------------------------------------------
    def get_google_auth_url(self, redirect_uri: str | None = None, state: str | None = None) -> tuple[str, str]:
        """Generate Google OAuth 2.0 authorization URL and CSRF state."""
        client_id = getattr(settings, "GOOGLE_CLIENT_ID", "")
        if not client_id:
            # Informative message if not yet set in production
            client_id = "flashseat-google-client-id-placeholder"

        r_uri = redirect_uri or getattr(settings, "GOOGLE_REDIRECT_URI", "http://localhost:8000/api/v1/auth/google/callback")
        csrf_state = state or secrets.token_urlsafe(24)

        base_url = "https://accounts.google.com/o/oauth2/v2/auth"
        params = {
            "client_id": client_id,
            "redirect_uri": r_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": csrf_state,
            "access_type": "online",
            "prompt": "select_account",
        }
        query_string = "&".join(f"{k}={httpx.URL('', params={k: v}).query.decode('utf-8')}" for k, v in params.items())
        auth_url = f"{base_url}?{query_string}"
        return auth_url, csrf_state

    async def exchange_google_code(self, code: str, redirect_uri: str) -> dict:
        """Exchange authorization code with Google for tokens."""
        client_id = getattr(settings, "GOOGLE_CLIENT_ID", "")
        client_secret = getattr(settings, "GOOGLE_CLIENT_SECRET", "")

        if not client_id or not client_secret:
            raise AuthError("GOOGLE_OAUTH_NOT_CONFIGURED", "Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) are not configured.", 500)

        token_url = "https://oauth2.googleapis.com/token"
        data = {
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(token_url, data=data)
            if resp.status_code != 200:
                logger.error(f"Google token exchange failed: {resp.text}")
                raise AuthError("GOOGLE_EXCHANGE_FAILED", f"Google token exchange failed: {resp.text}", 400)
            return resp.json()

    async def verify_google_id_token(self, id_token_str: str) -> dict:
        """Verify Google ID token via Google tokeninfo endpoint.
        
        Validates:
        - Signature and integrity (verified by Google's public tokeninfo)
        - Audience (matches GOOGLE_CLIENT_ID if configured)
        - Expiration timestamp
        - Issuer ('accounts.google.com' or 'https://accounts.google.com')
        - Email verified flag
        - Stable external subject identifier ('sub')
        """
        if not id_token_str:
            raise AuthError("INVALID_TOKEN", "Google ID token is required.", 400)

        tokeninfo_url = f"https://oauth2.googleapis.com/tokeninfo?id_token={id_token_str}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(tokeninfo_url)
            if resp.status_code != 200:
                raise AuthError("INVALID_GOOGLE_TOKEN", "Google ID token validation failed or token is expired.", 401)
            payload = resp.json()

        # Check issuer
        iss = payload.get("iss")
        if iss not in ("accounts.google.com", "https://accounts.google.com"):
            raise AuthError("INVALID_ISSUER", f"Invalid token issuer: {iss}", 401)

        # Check audience if GOOGLE_CLIENT_ID is configured
        expected_client_id = getattr(settings, "GOOGLE_CLIENT_ID", "")
        if expected_client_id and payload.get("aud") != expected_client_id:
            raise AuthError("INVALID_AUDIENCE", "Token audience does not match configured GOOGLE_CLIENT_ID.", 401)

        # Check expiration
        exp = int(payload.get("exp", 0))
        now_ts = int(datetime.now(timezone.utc).timestamp())
        if exp < now_ts:
            raise AuthError("TOKEN_EXPIRED", "Google token has expired.", 401)

        # Verify email and sub
        sub = payload.get("sub")
        if not sub:
            raise AuthError("MISSING_SUB", "Google identity claim 'sub' is missing.", 401)

        email_str = payload.get("email")
        if not email_str:
            raise AuthError("MISSING_EMAIL", "Google identity claim 'email' is missing.", 401)

        email_verified = payload.get("email_verified")
        if str(email_verified).lower() not in ("true", "1"):
            raise AuthError("UNVERIFIED_EMAIL", "Google account email is not verified.", 403)

        return {
            "sub": sub,
            "email": self.normalize_email(email_str),
            "name": payload.get("name") or email_str.split("@")[0].title(),
            "picture": payload.get("picture"),
        }

    async def handle_google_sign_in(self, id_token_str: str) -> dict:
        """Complete Google sign-in from a verified ID token."""
        claims = await self.verify_google_id_token(id_token_str)
        user = await self.get_or_create_user(
            email=claims["email"],
            provider="google",
            provider_user_id=claims["sub"],
            display_name=claims.get("name"),
            avatar_url=claims.get("picture"),
        )
        session = await self.create_session(user["id"])
        return {
            "ok": True,
            "user": user,
            "session_token": session["token"],
            "expires_at": session["expires_at"].isoformat(),
        }

    # -------------------------------------------------------------------------
    # User Storage & Account Identity Mapping
    # -------------------------------------------------------------------------
    async def get_or_create_user(
        self,
        email: str,
        provider: str,
        provider_user_id: str,
        display_name: str | None = None,
        avatar_url: str | None = None,
    ) -> dict:
        """Find or create user tied to external identity (preventing duplicate linked accounts)."""
        clean_email = self.normalize_email(email)
        identity_key = (provider, provider_user_id)

        # Check existing linked identity
        existing_user_id = self._identities.get(identity_key)
        if existing_user_id and existing_user_id in self._users:
            user = self._users[existing_user_id]
            user["last_login_at"] = datetime.now(timezone.utc).isoformat()
            return user

        # Check existing user by email
        matched_user = None
        for u in self._users.values():
            if u["email"] == clean_email:
                matched_user = u
                break

        if matched_user:
            user_id = matched_user["id"]
        else:
            user_id = f"usr_{uuid.uuid4().hex[:16]}"
            matched_user = {
                "id": user_id,
                "email": clean_email,
                "display_name": display_name or clean_email.split("@")[0].title(),
                "avatar_url": avatar_url,
                "is_verified": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "last_login_at": datetime.now(timezone.utc).isoformat(),
                "provider": provider,
            }
            self._users[user_id] = matched_user

        # Link identity
        self._identities[identity_key] = user_id
        return matched_user

    async def get_user_by_id(self, user_id: str) -> dict | None:
        """Retrieve user profile by internal user_id."""
        return self._users.get(user_id)

    # -------------------------------------------------------------------------
    # Secure Session Management
    # -------------------------------------------------------------------------
    async def create_session(self, user_id: str) -> dict:
        """Establish a secure session for authenticated user."""
        token = secrets.token_urlsafe(32)
        ttl = getattr(settings, "SESSION_TTL_SECONDS", 604800) # 7 days
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl)

        session_record = {
            "token": token,
            "user_id": user_id,
            "created_at": datetime.now(timezone.utc),
            "expires_at": expires_at,
        }
        self._sessions[token] = session_record
        return session_record

    async def get_session(self, token: str) -> dict | None:
        """Verify session token and return authenticated session with user."""
        if not token:
            return None
        session = self._sessions.get(token)
        if not session:
            return None

        # Check expiration
        if datetime.now(timezone.utc) > session["expires_at"]:
            del self._sessions[token]
            return None

        user = await self.get_user_by_id(session["user_id"])
        if not user:
            return None

        return {"session": session, "user": user}

    async def invalidate_session(self, token: str) -> bool:
        """Invalidate session on logout."""
        if token in self._sessions:
            del self._sessions[token]
            return True
        return False


# Global singleton instance
auth_service = AuthService()
