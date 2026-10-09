"""Razorpay Payment Gateway client service (Test Mode).

Implements official Razorpay REST API endpoints and HMAC-SHA256 signature verifications.
"""

import base64
import hashlib
import hmac
import logging
import time
from typing import Any, Optional
import uuid
import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class RazorpayService:
    """Async service for interacting with the Razorpay API and verifying cryptographic signatures."""

    def __init__(
        self,
        key_id: Optional[str] = None,
        key_secret: Optional[str] = None,
        webhook_secret: Optional[str] = None,
        api_base: Optional[str] = None,
        http_client: Optional[httpx.AsyncClient] = None,
    ):
        self.key_id = key_id or settings.RAZORPAY_KEY_ID
        self.key_secret = key_secret or settings.RAZORPAY_KEY_SECRET
        self.webhook_secret = webhook_secret or settings.RAZORPAY_WEBHOOK_SECRET
        self.api_base = (api_base or settings.RAZORPAY_API_BASE).rstrip("/")
        self._client = http_client

    def _get_auth_headers(self) -> dict[str, str]:
        auth_str = f"{self.key_id}:{self.key_secret}"
        encoded = base64.b64encode(auth_str.encode("utf-8")).decode("utf-8")
        return {
            "Authorization": f"Basic {encoded}",
            "Content-Type": "application/json",
        }

    async def create_order(
        self,
        amount: int,
        currency: str = "INR",
        receipt: Optional[str] = None,
        notes: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Create a Razorpay order via POST /v1/orders.

        Amount is specified in the smallest currency unit (e.g. paise for INR).
        """
        if self.key_id.startswith("rzp_test_placeholder") or "placeholder" in self.key_secret:
            order_id = f"order_{uuid.uuid4().hex[:14]}"
            logger.info("Simulated test Razorpay order %s for amount %d %s", order_id, amount, currency)
            return {
                "id": order_id,
                "entity": "order",
                "amount": amount,
                "amount_paid": 0,
                "amount_due": amount,
                "currency": currency,
                "receipt": receipt or "",
                "status": "created",
                "attempts": 0,
                "notes": notes or {},
                "created_at": int(time.time()),
            }

        url = f"{self.api_base}/orders"
        payload = {
            "amount": amount,
            "currency": currency,
            "receipt": receipt or "",
            "notes": notes or {},
        }
        headers = self._get_auth_headers()
        client = self._client or httpx.AsyncClient(timeout=10.0)
        try:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            logger.info("Created Razorpay order %s for amount %d %s", data.get("id"), amount, currency)
            return data
        except httpx.HTTPStatusError as e:
            logger.error("Razorpay create_order failed: HTTP %s - %s", e.response.status_code, e.response.text)
            raise
        except Exception as e:
            logger.error("Razorpay create_order network error: %s", e)
            raise
        finally:
            if client != self._client:
                await client.aclose()

    async def get_payment(self, payment_id: str) -> dict[str, Any]:
        """Retrieve payment details from Razorpay via GET /v1/payments/{payment_id}."""
        if self.key_id.startswith("rzp_test_placeholder") or "placeholder" in self.key_secret:
            return {
                "id": payment_id,
                "entity": "payment",
                "amount": settings.TICKET_PRICE_PAISE,
                "currency": "INR",
                "status": "captured",
                "order_id": f"order_{payment_id[4:]}",
                "invoice_id": None,
                "international": False,
                "method": "card",
                "captured": True,
            }

        url = f"{self.api_base}/payments/{payment_id}"
        headers = self._get_auth_headers()
        client = self._client or httpx.AsyncClient(timeout=10.0)
        try:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            logger.error("Razorpay get_payment failed for %s: HTTP %s", payment_id, e.response.status_code)
            raise
        except Exception as e:
            logger.error("Razorpay get_payment error for %s: %s", payment_id, e)
            raise
        finally:
            if client != self._client:
                await client.aclose()

    async def capture_payment(
        self,
        payment_id: str,
        amount: int,
        currency: str = "INR",
    ) -> dict[str, Any]:
        """Capture an authorized payment via POST /v1/payments/{payment_id}/capture."""
        url = f"{self.api_base}/payments/{payment_id}/capture"
        payload = {"amount": amount, "currency": currency}
        headers = self._get_auth_headers()
        client = self._client or httpx.AsyncClient(timeout=10.0)
        try:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            logger.info("Captured Razorpay payment %s for amount %d %s", payment_id, amount, currency)
            return data
        except httpx.HTTPStatusError as e:
            logger.error("Razorpay capture_payment failed for %s: HTTP %s", payment_id, e.response.status_code)
            raise
        finally:
            if client != self._client:
                await client.aclose()

    async def refund_payment(
        self,
        payment_id: str,
        amount: Optional[int] = None,
        notes: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Initiate refund for a payment via POST /v1/payments/{payment_id}/refund."""
        if self.key_id.startswith("rzp_test_placeholder") or "placeholder" in self.key_secret:
            rfnd_id = f"rfnd_{uuid.uuid4().hex[:14]}"
            logger.info("Simulated test Razorpay refund %s for payment %s", rfnd_id, payment_id)
            return {
                "id": rfnd_id,
                "entity": "refund",
                "amount": amount or settings.TICKET_PRICE_PAISE,
                "currency": "INR",
                "payment_id": payment_id,
                "status": "processed",
            }

        url = f"{self.api_base}/payments/{payment_id}/refund"
        payload: dict[str, Any] = {}
        if amount is not None:
            payload["amount"] = amount
        if notes:
            payload["notes"] = notes
        headers = self._get_auth_headers()
        client = self._client or httpx.AsyncClient(timeout=10.0)
        try:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            logger.info("Initiated refund %s for payment %s", data.get("id"), payment_id)
            return data
        except httpx.HTTPStatusError as e:
            logger.error("Razorpay refund_payment failed for %s: HTTP %s", payment_id, e.response.status_code)
            raise
        finally:
            if client != self._client:
                await client.aclose()

    def verify_checkout_signature(
        self,
        order_id: str,
        payment_id: str,
        signature: str,
    ) -> bool:
        """Verify checkout payment signature using HMAC-SHA256(order_id + '|' + payment_id, key_secret)."""
        if not order_id or not payment_id or not signature or not self.key_secret:
            return False
        message = f"{order_id}|{payment_id}".encode("utf-8")
        expected = hmac.new(
            self.key_secret.encode("utf-8"),
            message,
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(expected, signature)

    def verify_webhook_signature(
        self,
        raw_body: bytes,
        signature: Optional[str],
    ) -> bool:
        """Verify Razorpay webhook signature using HMAC-SHA256(raw_body, webhook_secret)."""
        if not signature or not self.webhook_secret or not raw_body:
            return False
        expected = hmac.new(
            self.webhook_secret.encode("utf-8"),
            raw_body,
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(expected, signature)


# Global singleton instance
razorpay_service = RazorpayService()
