"""Application configuration loaded from environment variables. Owned by [P1]."""

import os
from dataclasses import dataclass


@dataclass
class Settings:
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://redis:6379/0")
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://flash:flash@postgres:5432/flash")
    HOLD_TTL_MS: int = int(os.getenv("HOLD_TTL_MS", "120000"))
    RL_ENABLED: bool = os.getenv("RL_ENABLED", "true").lower() in ("true", "1", "yes")
    RL_CAPACITY: int = int(os.getenv("RL_CAPACITY", "20"))
    RL_REFILL_PER_SEC: int = int(os.getenv("RL_REFILL_PER_SEC", "10"))
    PG_POOL_MAX: int = int(os.getenv("PG_POOL_MAX", "10"))
    BASELINE_POOL_MAX: int = int(os.getenv("BASELINE_POOL_MAX", "10"))
    WRITER_BATCH: int = int(os.getenv("WRITER_BATCH", "200"))
    WRITER_BLOCK_MS: int = int(os.getenv("WRITER_BLOCK_MS", "500"))
    DEFAULT_EVENT_ID: str = os.getenv("DEFAULT_EVENT_ID", "evt1")
    DEFAULT_SEAT_COUNT: int = int(os.getenv("DEFAULT_SEAT_COUNT", "200"))
    CORS_ORIGINS: str = os.getenv("CORS_ORIGINS", "*")
    ADMIN_SECRET_KEY: str = os.getenv("ADMIN_SECRET_KEY", "flash_admin_sec_2026")
    WAITING_ROOM_ENABLED: bool = os.getenv("WAITING_ROOM_ENABLED", "false").lower() in ("true", "1", "yes")
    WAITING_ROOM_MAX_ADMITTED: int = int(os.getenv("WAITING_ROOM_MAX_ADMITTED", "50"))
    WAITING_ROOM_TOKEN_TTL_SEC: int = int(os.getenv("WAITING_ROOM_TOKEN_TTL_SEC", "300"))
    WAITING_ROOM_ADMISSION_RATE: int = int(os.getenv("WAITING_ROOM_ADMISSION_RATE", "10"))
    WAITING_ROOM_MAX_QUEUE_SIZE: int = int(os.getenv("WAITING_ROOM_MAX_QUEUE_SIZE", "10000"))
    WAITING_ROOM_ENTRY_TTL_SEC: int = int(os.getenv("WAITING_ROOM_ENTRY_TTL_SEC", "600"))
    WAITING_ROOM_POLL_INTERVAL_MS: int = int(os.getenv("WAITING_ROOM_POLL_INTERVAL_MS", "2000"))
    WAITING_ROOM_CLEANUP_INTERVAL_SEC: int = int(os.getenv("WAITING_ROOM_CLEANUP_INTERVAL_SEC", "30"))

    # Razorpay Payment Gateway (Test Mode)
    RAZORPAY_KEY_ID: str = os.getenv("RAZORPAY_KEY_ID", "rzp_test_placeholder_key_id")
    RAZORPAY_KEY_SECRET: str = os.getenv("RAZORPAY_KEY_SECRET", "mock_secret_key_1234567890")
    RAZORPAY_WEBHOOK_SECRET: str = os.getenv("RAZORPAY_WEBHOOK_SECRET", "mock_webhook_secret_987654321")
    RAZORPAY_API_BASE: str = os.getenv("RAZORPAY_API_BASE", "https://api.razorpay.com/v1")
    TICKET_PRICE_PAISE: int = int(os.getenv("TICKET_PRICE_PAISE", "50000"))  # 50,000 paise = 500 INR

    # Authentication (Google OAuth + Email OTP)
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
    GOOGLE_REDIRECT_URI: str = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/v1/auth/google/callback")
    EMAIL_PROVIDER: str = os.getenv("EMAIL_PROVIDER", "smtp")
    SMTP_HOST: str = os.getenv("SMTP_HOST", "")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USERNAME: str = os.getenv("SMTP_USERNAME", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_USE_TLS: bool = os.getenv("SMTP_USE_TLS", "true").lower() in ("true", "1", "yes")
    EMAIL_FROM: str = os.getenv("EMAIL_FROM", "FlashSeat <noreply@flashseat.com>")
    OTP_TTL_SECONDS: int = int(os.getenv("OTP_TTL_SECONDS", "300"))
    OTP_RESEND_COOLDOWN_SECONDS: int = int(os.getenv("OTP_RESEND_COOLDOWN_SECONDS", "60"))
    OTP_MAX_ATTEMPTS: int = int(os.getenv("OTP_MAX_ATTEMPTS", "5"))
    SESSION_SECRET: str = os.getenv("SESSION_SECRET", "flashseat_secure_session_secret_2026")
    SESSION_TTL_SECONDS: int = int(os.getenv("SESSION_TTL_SECONDS", "604800"))
    SESSION_COOKIE_NAME: str = os.getenv("SESSION_COOKIE_NAME", "flashseat_session")
    SESSION_COOKIE_SECURE: bool = os.getenv("SESSION_COOKIE_SECURE", "false").lower() in ("true", "1", "yes")


settings = Settings()

