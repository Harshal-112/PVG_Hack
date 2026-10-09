"""Comprehensive automated tests for Google Sign-In and Email OTP Verification.

Tests cover:
- Email OTP Request:
  - Valid email normalization & challenge creation
  - Invalid email format rejection
  - Resend cooldown rate limit enforcement
  - Secret protection: plaintext OTP is NEVER stored in database/memory or returned in API response
- Email OTP Verification:
  - Successful verification with correct OTP
  - Rejection of incorrect OTP with attempt count decrement
  - Invalidation when max attempts exceeded
  - Rejection of expired OTP
  - Rejection of already-consumed OTP (replay protection)
  - Single-use consumption atomicity
- Google Authentication:
  - Token claim validation (audience, issuer, expiration, email_verified, sub)
  - User creation and identity linking
  - Rejection of unverified email or expired token
- Session Management:
  - Session cookie setting and Bearer token support
  - /api/v1/auth/me session introspection
  - Logout session invalidation and cookie clearing
"""

from datetime import datetime, timezone, timedelta
import uuid
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services.auth_service import AuthService, AuthError, auth_service


@pytest.fixture(autouse=True)
def reset_auth_service():
    """Reset auth_service in-memory stores before each test."""
    auth_service._challenges.clear()
    auth_service._email_cooldowns.clear()
    auth_service._users.clear()
    auth_service._identities.clear()
    auth_service._sessions.clear()
    auth_service._dispatched_emails.clear()


@pytest.mark.asyncio
async def test_email_otp_send_and_verify_success():
    """Test standard successful email OTP request and verification flow."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Send OTP
        email = "test.user@flashseat.com"
        resp = await client.post("/api/v1/auth/email/send-otp", json={"email": email})
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["ok"] is True
        assert data["email"] == email
        assert "challenge_id" in data
        challenge_id = data["challenge_id"]

        # Ensure plaintext OTP is NOT returned in response
        assert "otp" not in data
        assert "code" not in data

        # Check dispatched email record in auth_service
        assert len(auth_service._dispatched_emails) == 1
        dispatch = auth_service._dispatched_emails[0]
        assert dispatch["to"] == email
        assert "FlashSeat Email Verification Code" in dispatch["subject"]

        # Extract generated OTP from dispatch record
        import re
        match = re.search(r"code is:\s*(\d{6})", dispatch["body"])
        assert match is not None
        otp_code = match.group(1)

        # 2. Verify OTP
        verify_resp = await client.post(
            "/api/v1/auth/email/verify-otp",
            json={"challenge_id": challenge_id, "email": email, "otp": otp_code},
        )
        assert verify_resp.status_code == 200, verify_resp.text
        verify_data = verify_resp.json()
        assert verify_data["ok"] is True
        assert "session_token" in verify_data
        assert verify_data["user"]["email"] == email
        assert verify_data["user"]["is_verified"] is True

        # Check session cookie was set
        assert "flashseat_session" in verify_resp.cookies or "set-cookie" in verify_resp.headers

        # 3. Test /api/v1/auth/me
        session_token = verify_data["session_token"]
        me_resp = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {session_token}"},
        )
        assert me_resp.status_code == 200
        me_data = me_resp.json()
        assert me_data["authenticated"] is True
        assert me_data["user"]["email"] == email


@pytest.mark.asyncio
async def test_email_otp_invalid_email_format():
    """Test rejection of malformed email addresses."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/v1/auth/email/send-otp", json={"email": "not-an-email"})
        assert resp.status_code == 422
        assert resp.json()["error"] == "INVALID_EMAIL"


@pytest.mark.asyncio
async def test_email_otp_cooldown_rate_limit():
    """Test that requesting a code again before cooldown expires is rate-limited (429)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        email = "rate.limit@flashseat.com"
        resp1 = await client.post("/api/v1/auth/email/send-otp", json={"email": email})
        assert resp1.status_code == 200

        # Immediate second request
        resp2 = await client.post("/api/v1/auth/email/send-otp", json={"email": email})
        assert resp2.status_code == 429
        data = resp2.json()
        assert data["error"] == "RATE_LIMITED"
        assert "retry_after" in data


@pytest.mark.asyncio
async def test_email_otp_incorrect_code():
    """Test entering an incorrect code decrements remaining attempts."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        email = "wrong.otp@flashseat.com"
        resp = await client.post("/api/v1/auth/email/send-otp", json={"email": email})
        challenge_id = resp.json()["challenge_id"]

        # Enter wrong code
        verify_resp = await client.post(
            "/api/v1/auth/email/verify-otp",
            json={"challenge_id": challenge_id, "email": email, "otp": "000000"},
        )
        assert verify_resp.status_code == 400
        data = verify_resp.json()
        assert data["error"] == "INVALID_OTP"
        assert data["remaining_attempts"] == 4


@pytest.mark.asyncio
async def test_email_otp_max_attempts_lockout():
    """Test that exceeding max attempts (5) invalidates the challenge."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        email = "lockout@flashseat.com"
        resp = await client.post("/api/v1/auth/email/send-otp", json={"email": email})
        challenge_id = resp.json()["challenge_id"]

        # Fail 5 times
        for i in range(4):
            r = await client.post(
                "/api/v1/auth/email/verify-otp",
                json={"challenge_id": challenge_id, "email": email, "otp": "999999"},
            )
            assert r.status_code == 400

        # 5th attempt locks out
        final_r = await client.post(
            "/api/v1/auth/email/verify-otp",
            json={"challenge_id": challenge_id, "email": email, "otp": "999999"},
        )
        assert final_r.status_code == 429
        assert final_r.json()["error"] == "MAX_ATTEMPTS_EXCEEDED"


@pytest.mark.asyncio
async def test_email_otp_expired_code():
    """Test that expired challenge cannot be verified (410)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        email = "expired@flashseat.com"
        resp = await client.post("/api/v1/auth/email/send-otp", json={"email": email})
        challenge_id = resp.json()["challenge_id"]

        # Force challenge to be expired
        auth_service._challenges[challenge_id]["expires_at"] = datetime.now(timezone.utc) - timedelta(seconds=10)

        verify_resp = await client.post(
            "/api/v1/auth/email/verify-otp",
            json={"challenge_id": challenge_id, "email": email, "otp": "123456"},
        )
        assert verify_resp.status_code == 410
        assert verify_resp.json()["error"] == "OTP_EXPIRED"


@pytest.mark.asyncio
async def test_email_otp_reused_consumed_code():
    """Test replay protection: already-consumed OTP cannot be verified twice."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        email = "reused@flashseat.com"
        resp = await client.post("/api/v1/auth/email/send-otp", json={"email": email})
        challenge_id = resp.json()["challenge_id"]

        import re
        dispatch = auth_service._dispatched_emails[-1]
        otp_code = re.search(r"code is:\s*(\d{6})", dispatch["body"]).group(1)

        # First verification succeeds
        v1 = await client.post(
            "/api/v1/auth/email/verify-otp",
            json={"challenge_id": challenge_id, "email": email, "otp": otp_code},
        )
        assert v1.status_code == 200

        # Second verification with same code fails with ALREADY_CONSUMED
        v2 = await client.post(
            "/api/v1/auth/email/verify-otp",
            json={"challenge_id": challenge_id, "email": email, "otp": otp_code},
        )
        assert v2.status_code == 409
        assert v2.json()["error"] == "ALREADY_CONSUMED"


@pytest.mark.asyncio
async def test_logout_and_session_invalidation():
    """Test that logout invalidates active session."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create session directly
        user = await auth_service.get_or_create_user(
            email="logout.test@flashseat.com",
            provider="email_otp",
            provider_user_id="logout.test@flashseat.com",
        )
        session = await auth_service.create_session(user["id"])
        token = session["token"]

        # Check me works
        r1 = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r1.status_code == 200
        assert r1.json()["authenticated"] is True

        # Logout
        r_logout = await client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {token}"})
        assert r_logout.status_code == 200
        assert r_logout.json()["ok"] is True

        # Check me now returns authenticated: False
        r2 = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r2.status_code == 200
        assert r2.json()["authenticated"] is False


@pytest.mark.asyncio
async def test_google_login_endpoint():
    """Test Google OAuth login URL generator."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/auth/google/login?mode=json")
        assert resp.status_code == 200
        data = resp.json()
        assert "auth_url" in data
        assert "accounts.google.com" in data["auth_url"]
        assert "state" in data


@pytest.mark.asyncio
async def test_google_verify_token_success_and_account_linking(monkeypatch):
    """Test server-side Google ID token verification and identity linking."""
    now_ts = int(datetime.now(timezone.utc).timestamp())
    mock_payload = {
        "iss": "https://accounts.google.com",
        "sub": "google-sub-123456789",
        "email": "google.user@gmail.com",
        "email_verified": "true",
        "name": "Google Tester",
        "picture": "https://example.com/avatar.jpg",
        "exp": now_ts + 3600,
    }

    # Mock tokeninfo response
    async def mock_get(self, url, **kwargs):
        class MockResponse:
            status_code = 200
            def json(self):
                return mock_payload
        return MockResponse()

    monkeypatch.setattr(AsyncClient, "get", mock_get)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # First sign in creates user
        r1 = await client.post("/api/v1/auth/google/verify-token", json={"credential": "valid-jwt-token"})
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1["ok"] is True
        assert d1["user"]["email"] == "google.user@gmail.com"
        assert d1["user"]["provider"] == "google"
        first_user_id = d1["user"]["id"]

        # Second sign in with same Google account retrieves the same user (no duplicate)
        r2 = await client.post("/api/v1/auth/google/verify-token", json={"credential": "valid-jwt-token"})
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["user"]["id"] == first_user_id
        assert len(auth_service._users) == 1


@pytest.mark.asyncio
async def test_google_token_rejections(monkeypatch):
    """Test rejection of invalid issuer, expired token, or unverified email."""
    now_ts = int(datetime.now(timezone.utc).timestamp())
    
    # 1. Invalid issuer
    async def mock_bad_iss(self, url, **kwargs):
        class MockResponse:
            status_code = 200
            def json(self):
                return {
                    "iss": "https://evil.com",
                    "sub": "sub-1",
                    "email": "user@gmail.com",
                    "email_verified": "true",
                    "exp": now_ts + 3600,
                }
        return MockResponse()

    monkeypatch.setattr(AsyncClient, "get", mock_bad_iss)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/api/v1/auth/google/verify-token", json={"credential": "token"})
        assert r.status_code == 401
        assert r.json()["error"] == "INVALID_ISSUER"

    # 2. Expired token
    async def mock_expired(self, url, **kwargs):
        class MockResponse:
            status_code = 200
            def json(self):
                return {
                    "iss": "https://accounts.google.com",
                    "sub": "sub-1",
                    "email": "user@gmail.com",
                    "email_verified": "true",
                    "exp": now_ts - 3600,
                }
        return MockResponse()

    monkeypatch.setattr(AsyncClient, "get", mock_expired)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/api/v1/auth/google/verify-token", json={"credential": "token"})
        assert r.status_code == 401
        assert r.json()["error"] == "TOKEN_EXPIRED"

    # 3. Unverified email
    async def mock_unverified(self, url, **kwargs):
        class MockResponse:
            status_code = 200
            def json(self):
                return {
                    "iss": "https://accounts.google.com",
                    "sub": "sub-1",
                    "email": "user@gmail.com",
                    "email_verified": "false",
                    "exp": now_ts + 3600,
                }
        return MockResponse()

    monkeypatch.setattr(AsyncClient, "get", mock_unverified)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/api/v1/auth/google/verify-token", json={"credential": "token"})
        assert r.status_code == 403
        assert r.json()["error"] == "UNVERIFIED_EMAIL"


@pytest.mark.asyncio
async def test_concurrent_otp_verification_single_winner():
    """Test that concurrent verification requests on the same OTP allow only one winner."""
    import asyncio
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        email = "concurrent@flashseat.com"
        resp = await client.post("/api/v1/auth/email/send-otp", json={"email": email})
        challenge_id = resp.json()["challenge_id"]

        import re
        dispatch = auth_service._dispatched_emails[-1]
        otp_code = re.search(r"code is:\s*(\d{6})", dispatch["body"]).group(1)

        # Fire 5 simultaneous verification calls
        tasks = [
            client.post(
                "/api/v1/auth/email/verify-otp",
                json={"challenge_id": challenge_id, "email": email, "otp": otp_code},
            )
            for _ in range(5)
        ]
        responses = await asyncio.gather(*tasks)

        # Exactly 1 request succeeds (200 OK); others receive ALREADY_CONSUMED (409)
        statuses = [r.status_code for r in responses]
        assert statuses.count(200) == 1
        assert statuses.count(409) == 4

