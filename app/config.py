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

    # Razorpay Payment Gateway (Test Mode)
    RAZORPAY_KEY_ID: str = os.getenv("RAZORPAY_KEY_ID", "rzp_test_placeholder_key_id")
    RAZORPAY_KEY_SECRET: str = os.getenv("RAZORPAY_KEY_SECRET", "mock_secret_key_1234567890")
    RAZORPAY_WEBHOOK_SECRET: str = os.getenv("RAZORPAY_WEBHOOK_SECRET", "mock_webhook_secret_987654321")
    RAZORPAY_API_BASE: str = os.getenv("RAZORPAY_API_BASE", "https://api.razorpay.com/v1")
    TICKET_PRICE_PAISE: int = int(os.getenv("TICKET_PRICE_PAISE", "50000"))  # 50,000 paise = 500 INR
    CORS_ORIGINS: str = os.getenv("CORS_ORIGINS", "*")


settings = Settings()

