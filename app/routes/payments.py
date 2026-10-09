"""Payment routes for Razorpay checkout, verification, status, and webhooks."""

import json
import logging
import time
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app import db
from app.config import settings
from app.ratelimit import rate_limiter
from app.services.razorpay import razorpay_service

logger = logging.getLogger(__name__)

router = APIRouter()


class CreateOrderRequest(BaseModel):
    event_id: str = Field(..., min_length=1)
    reservation_id: str = Field(..., min_length=1)
    user_id: str = Field(..., min_length=1, max_length=64)


class CreateOrderResponse(BaseModel):
    payment_id: str
    razorpay_order_id: str
    amount: int
    currency: str
    key_id: str
    seat_id: str
    event_id: str
    expires_at_ms: Optional[int] = None


class VerifyPaymentRequest(BaseModel):
    event_id: str = Field(..., min_length=1)
    reservation_id: str = Field(..., min_length=1)
    user_id: str = Field(..., min_length=1, max_length=64)
    razorpay_order_id: str = Field(..., min_length=1)
    razorpay_payment_id: str = Field(..., min_length=1)
    razorpay_signature: str = Field(..., min_length=1)


class VerifyPaymentResponse(BaseModel):
    status: str
    booking_reference: str
    event_id: str
    seat_id: str
    user_id: str
    amount: int
    currency: str
    payment_id: str
    order_id: str
    idempotent: bool


class PaymentStatusResponse(BaseModel):
    payment_id: str
    razorpay_order_id: str
    razorpay_payment_id: Optional[str] = None
    payment_status: str
    booking_status: str
    booking_reference: Optional[str] = None
    event_id: str
    seat_id: str
    amount: int
    currency: str
    refund_id: Optional[str] = None


class ErrorResponse(BaseModel):
    error: str
    message: str


@router.post(
    "/payments/order",
    status_code=201,
    response_model=CreateOrderResponse,
    responses={
        400: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        410: {"model": ErrorResponse},
    },
    dependencies=[Depends(rate_limiter)] if settings.RL_ENABLED else [],
)
async def create_payment_order(body: CreateOrderRequest, request: Request):
    """Validate held reservation and create a Razorpay order with server-determined pricing."""
    inventory = getattr(request.app.state, "inventory", None)
    if not inventory:
        raise HTTPException(status_code=500, detail={"error": "SERVER_ERROR", "message": "Inventory service unavailable"})

    # Inspect reservation in Redis
    res_info = None
    if hasattr(inventory, "get_reservation"):
        res_info = await inventory.get_reservation(body.event_id, body.reservation_id)
    elif hasattr(inventory, "events") and body.event_id in inventory.events:
        # Mock/fake inventory inspection fallback
        ev = inventory.events[body.event_id]
        if body.reservation_id in ev.get("rids", {}):
            st, seat = ev["rids"][body.reservation_id]
            exp = ev.get("holds", {}).get(seat, (None, None))[1]
            res_info = {"status": st, "seat_id": seat, "expires_at_ms": exp}

    if not res_info:
        return JSONResponse(
            status_code=404,
            content={"error": "RESERVATION_NOT_FOUND", "message": "Reservation not found"},
        )

    status = res_info.get("status")
    seat_id = res_info.get("seat_id")
    expires_at_ms = res_info.get("expires_at_ms")

    if status == "CONFIRMED":
        return JSONResponse(
            status_code=409,
            content={"error": "ALREADY_CONFIRMED", "message": "Reservation is already confirmed"},
        )
    if status != "HELD":
        return JSONResponse(
            status_code=410,
            content={"error": "HOLD_EXPIRED", "message": "Reservation hold has expired or was released"},
        )

    # Check expiration timestamp against current server time
    now_ms = int(time.time() * 1000)
    if expires_at_ms is not None and now_ms >= expires_at_ms:
        return JSONResponse(
            status_code=410,
            content={"error": "HOLD_EXPIRED", "message": "Reservation hold has expired"},
        )

    # Check if a payment record already exists for this reservation (idempotency)
    existing_payment = await db.get_payment_by_reservation_id(body.reservation_id)
    if existing_payment:
        if existing_payment.get("payment_status") == "paid":
            return JSONResponse(
                status_code=409,
                content={"error": "ALREADY_PAID", "message": "Reservation has already been paid and confirmed"},
            )
        # Return existing active order details
        return JSONResponse(
            status_code=201,
            content={
                "payment_id": existing_payment.get("payment_id_internal"),
                "razorpay_order_id": existing_payment.get("razorpay_order_id"),
                "amount": existing_payment.get("amount"),
                "currency": existing_payment.get("currency", "INR"),
                "key_id": razorpay_service.key_id,
                "seat_id": existing_payment.get("seat_id"),
                "event_id": existing_payment.get("event_id"),
                "expires_at_ms": expires_at_ms,
            },
        )

    # Server is the sole authority on pricing
    amount = settings.TICKET_PRICE_PAISE
    currency = "INR"

    # Create order via Razorpay API
    rz_order = await razorpay_service.create_order(
        amount=amount,
        currency=currency,
        receipt=body.reservation_id,
        notes={
            "event_id": body.event_id,
            "seat_id": seat_id,
            "reservation_id": body.reservation_id,
            "user_id": body.user_id,
        },
    )

    payment_id_internal = f"pay_int_{uuid.uuid4().hex[:16]}"
    order_id = rz_order.get("id")

    # Persist durable payment record in PostgreSQL
    payment_record = {
        "payment_id_internal": payment_id_internal,
        "reservation_id": body.reservation_id,
        "event_id": body.event_id,
        "seat_id": seat_id,
        "user_id": body.user_id,
        "razorpay_order_id": order_id,
        "amount": amount,
        "currency": currency,
        "payment_status": "created",
        "booking_status": "pending",
    }
    await db.create_payment_record(payment_record)

    return JSONResponse(
        status_code=201,
        content={
            "payment_id": payment_id_internal,
            "razorpay_order_id": order_id,
            "amount": amount,
            "currency": currency,
            "key_id": razorpay_service.key_id,
            "seat_id": seat_id,
            "event_id": body.event_id,
            "expires_at_ms": expires_at_ms,
        },
    )


@router.post(
    "/payments/verify",
    status_code=200,
    response_model=VerifyPaymentResponse,
    responses={
        400: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        410: {"model": ErrorResponse},
    },
)
async def verify_payment(body: VerifyPaymentRequest, request: Request):
    """Verify Razorpay payment signature, validate status and amount, and confirm booking."""
    inventory = getattr(request.app.state, "inventory", None)
    if not inventory:
        raise HTTPException(status_code=500, detail={"error": "SERVER_ERROR", "message": "Inventory service unavailable"})

    # 1. Cryptographic HMAC-SHA256 signature verification
    valid_sig = razorpay_service.verify_checkout_signature(
        order_id=body.razorpay_order_id,
        payment_id=body.razorpay_payment_id,
        signature=body.razorpay_signature,
    )
    if not valid_sig:
        logger.warning("Invalid payment signature for order %s", body.razorpay_order_id)
        return JSONResponse(
            status_code=400,
            content={"error": "INVALID_SIGNATURE", "message": "Payment signature verification failed"},
        )

    # 2. Retrieve payment record from database
    payment = await db.get_payment_by_order_id(body.razorpay_order_id)
    if not payment:
        return JSONResponse(
            status_code=404,
            content={"error": "ORDER_NOT_FOUND", "message": "Payment order record not found"},
        )

    # Validate reservation ownership
    if payment.get("reservation_id") != body.reservation_id or payment.get("user_id") != body.user_id:
        return JSONResponse(
            status_code=400,
            content={"error": "RESERVATION_MISMATCH", "message": "Payment order does not match reservation credentials"},
        )

    # 3. Idempotency: if already paid and confirmed, return existing confirmation
    if payment.get("payment_status") == "paid" and payment.get("booking_status") == "confirmed":
        return JSONResponse(
            status_code=200,
            content={
                "status": "CONFIRMED",
                "booking_reference": payment.get("booking_reference"),
                "event_id": payment.get("event_id"),
                "seat_id": payment.get("seat_id"),
                "user_id": payment.get("user_id"),
                "amount": payment.get("amount"),
                "currency": payment.get("currency"),
                "payment_id": payment.get("razorpay_payment_id") or body.razorpay_payment_id,
                "order_id": payment.get("razorpay_order_id"),
                "idempotent": True,
            },
        )

    # 4. Verify payment status, amount, and capture with Razorpay
    try:
        rz_payment = await razorpay_service.get_payment(body.razorpay_payment_id)
    except Exception as e:
        logger.error("Failed to fetch payment from Razorpay: %s", e)
        return JSONResponse(
            status_code=502,
            content={"error": "GATEWAY_ERROR", "message": "Failed to verify payment with payment gateway"},
        )

    # Verify amount and currency
    expected_amount = payment.get("amount")
    expected_currency = payment.get("currency", "INR")
    if rz_payment.get("amount") != expected_amount or rz_payment.get("currency") != expected_currency:
        logger.error(
            "Payment amount/currency mismatch: expected %s %s, got %s %s",
            expected_amount, expected_currency, rz_payment.get("amount"), rz_payment.get("currency")
        )
        await db.update_payment_record(
            body.razorpay_order_id,
            payment_status="failed",
            error_code="AMOUNT_MISMATCH",
            error_description=f"Expected {expected_amount} {expected_currency}, got {rz_payment.get('amount')} {rz_payment.get('currency')}",
        )
        return JSONResponse(
            status_code=400,
            content={"error": "AMOUNT_MISMATCH", "message": "Payment amount or currency mismatch"},
        )

    # Ensure captured status (auto-capture if authorized)
    pay_status = rz_payment.get("status")
    if pay_status == "authorized":
        try:
            rz_payment = await razorpay_service.capture_payment(body.razorpay_payment_id, expected_amount, expected_currency)
            pay_status = rz_payment.get("status")
        except Exception as e:
            logger.error("Failed to capture authorized payment: %s", e)

    if pay_status != "captured":
        await db.update_payment_record(
            body.razorpay_order_id,
            payment_status="failed",
            error_code="NOT_CAPTURED",
            error_description=f"Payment status is {pay_status}",
        )
        return JSONResponse(
            status_code=400,
            content={"error": "PAYMENT_NOT_CAPTURED", "message": f"Payment is not captured (status: {pay_status})"},
        )

    # 5. Atomic booking confirmation via existing Redis inventory engine
    confirm_result = await inventory.confirm(body.event_id, body.reservation_id, body.user_id)

    if confirm_result.code in ("OK", "ALREADY_CONFIRMED"):
        seat_id = confirm_result.seat_id or payment.get("seat_id")
        booking_ref = f"BK-{body.event_id.upper()}-{seat_id}-{body.reservation_id[:8].upper()}"

        await db.update_payment_record(
            body.razorpay_order_id,
            payment_status="paid",
            booking_status="confirmed",
            razorpay_payment_id=body.razorpay_payment_id,
            booking_reference=booking_ref,
        )

        return JSONResponse(
            status_code=200,
            content={
                "status": "CONFIRMED",
                "booking_reference": booking_ref,
                "event_id": body.event_id,
                "seat_id": seat_id,
                "user_id": body.user_id,
                "amount": expected_amount,
                "currency": expected_currency,
                "payment_id": body.razorpay_payment_id,
                "order_id": body.razorpay_order_id,
                "idempotent": (confirm_result.code == "ALREADY_CONFIRMED"),
            },
        )

    elif confirm_result.code == "HOLD_EXPIRED":
        # Payment was captured, but reservation expired before confirmation.
        # Strict rule: DO NOT issue ticket. Trigger automatic refund.
        logger.warning(
            "Reservation hold expired for reservation %s after payment capture. Initiating refund.",
            body.reservation_id
        )
        refund_id = None
        try:
            refund_resp = await razorpay_service.refund_payment(
                body.razorpay_payment_id,
                amount=expected_amount,
                notes={"reason": "Reservation hold expired before booking confirmation"},
            )
            refund_id = refund_resp.get("id")
            refund_status = "refunded" if refund_resp.get("status") == "processed" else "refund_pending"
        except Exception as e:
            logger.critical("Automatic refund failed for captured payment %s: %s", body.razorpay_payment_id, e)
            refund_status = "manual_reconciliation"

        await db.update_payment_record(
            body.razorpay_order_id,
            payment_status=refund_status,
            booking_status="expired",
            razorpay_payment_id=body.razorpay_payment_id,
            refund_id=refund_id,
            error_code="HOLD_EXPIRED",
            error_description="Reservation expired before confirmation; refund initiated",
        )

        return JSONResponse(
            status_code=410,
            content={
                "error": "HOLD_EXPIRED",
                "message": "Reservation hold expired before booking confirmation. A full refund has been initiated.",
                "refund_id": refund_id,
                "payment_status": refund_status,
                "booking_status": "expired",
            },
        )

    else:
        # Unknown error during confirmation
        logger.error("Confirmation error %s for reservation %s", confirm_result.code, body.reservation_id)
        await db.update_payment_record(
            body.razorpay_order_id,
            payment_status="manual_reconciliation",
            booking_status="failed",
            razorpay_payment_id=body.razorpay_payment_id,
            error_code=confirm_result.code,
        )
        return JSONResponse(
            status_code=400,
            content={"error": confirm_result.code, "message": f"Confirmation failed: {confirm_result.code}"},
        )


@router.get(
    "/payments/{identifier}/status",
    status_code=200,
    response_model=PaymentStatusResponse,
    responses={404: {"model": ErrorResponse}},
)
async def get_payment_status(identifier: str):
    """Retrieve durable payment and booking status by internal ID, order ID, or reservation ID."""
    payment = (
        await db.get_payment_by_order_id(identifier)
        or await db.get_payment_by_id(identifier)
        or await db.get_payment_by_reservation_id(identifier)
        or await db.get_payment_by_razorpay_payment_id(identifier)
    )

    if not payment:
        return JSONResponse(
            status_code=404,
            content={"error": "PAYMENT_NOT_FOUND", "message": "Payment record not found"},
        )

    return JSONResponse(
        status_code=200,
        content={
            "payment_id": payment.get("payment_id_internal"),
            "razorpay_order_id": payment.get("razorpay_order_id"),
            "razorpay_payment_id": payment.get("razorpay_payment_id"),
            "payment_status": payment.get("payment_status"),
            "booking_status": payment.get("booking_status"),
            "booking_reference": payment.get("booking_reference"),
            "event_id": payment.get("event_id"),
            "seat_id": payment.get("seat_id"),
            "amount": payment.get("amount"),
            "currency": payment.get("currency", "INR"),
            "refund_id": payment.get("refund_id"),
        },
    )


@router.post("/payments/webhook", status_code=200)
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: Optional[str] = Header(None, alias="X-Razorpay-Signature"),
):
    """Receive and verify Razorpay webhook notifications."""
    raw_body = await request.body()

    # 1. Signature verification using webhook secret
    if not razorpay_service.verify_webhook_signature(raw_body, x_razorpay_signature):
        logger.warning("Rejected webhook: invalid signature")
        return JSONResponse(status_code=400, content={"error": "INVALID_WEBHOOK_SIGNATURE"})

    try:
        data = json.loads(raw_body.decode("utf-8"))
    except Exception as e:
        logger.error("Failed to parse webhook JSON body: %s", e)
        return JSONResponse(status_code=400, content={"error": "INVALID_JSON"})

    event_id = data.get("event_id") or data.get("id") or f"evt_{uuid.uuid4().hex}"
    event_type = data.get("event", "unknown")

    # 2. Idempotent event deduplication
    is_new = await db.record_webhook_event(event_id, event_type, raw_body.decode("utf-8"))
    if not is_new:
        logger.info("Webhook event %s already processed (deduplicated)", event_id)
        return JSONResponse(status_code=200, content={"status": "already_processed"})

    # 3. Process event types
    inventory = getattr(request.app.state, "inventory", None)

    if event_type in ("payment.captured", "order.paid") and inventory:
        pay_entity = data.get("payload", {}).get("payment", {}).get("entity", {})
        order_id = pay_entity.get("order_id")
        payment_id = pay_entity.get("id")

        if order_id:
            payment = await db.get_payment_by_order_id(order_id)
            if payment and payment.get("payment_status") != "paid":
                # Webhook arrived before or in lieu of client verification: confirm booking
                confirm_res = await inventory.confirm(payment["event_id"], payment["reservation_id"], payment["user_id"])
                if confirm_res.code in ("OK", "ALREADY_CONFIRMED"):
                    booking_ref = f"BK-{payment['event_id'].upper()}-{confirm_res.seat_id or payment['seat_id']}-{payment['reservation_id'][:8].upper()}"
                    await db.update_payment_record(
                        order_id,
                        payment_status="paid",
                        booking_status="confirmed",
                        razorpay_payment_id=payment_id,
                        booking_reference=booking_ref,
                    )
                    logger.info("Webhook successfully confirmed booking %s for order %s", booking_ref, order_id)
                elif confirm_res.code == "HOLD_EXPIRED":
                    # Expired before webhook: trigger refund
                    logger.warning("Webhook detected expired hold for order %s. Initiating refund.", order_id)
                    refund_id = None
                    try:
                        refund_resp = await razorpay_service.refund_payment(
                            payment_id,
                            amount=payment["amount"],
                            notes={"reason": "Reservation hold expired"},
                        )
                        refund_id = refund_resp.get("id")
                    except Exception as e:
                        logger.error("Webhook refund failed: %s", e)

                    await db.update_payment_record(
                        order_id,
                        payment_status="refunded" if refund_id else "refund_pending",
                        booking_status="expired",
                        razorpay_payment_id=payment_id,
                        refund_id=refund_id,
                        error_code="HOLD_EXPIRED",
                    )

    elif event_type == "payment.failed":
        pay_entity = data.get("payload", {}).get("payment", {}).get("entity", {})
        order_id = pay_entity.get("order_id")
        if order_id:
            error_code = pay_entity.get("error_code")
            error_desc = pay_entity.get("error_description")
            await db.update_payment_record(
                order_id,
                payment_status="failed",
                booking_status="failed",
                error_code=error_code,
                error_description=error_desc,
            )

    elif event_type == "refund.processed":
        refund_entity = data.get("payload", {}).get("refund", {}).get("entity", {})
        payment_id = refund_entity.get("payment_id")
        refund_id = refund_entity.get("id")
        if payment_id:
            payment = await db.get_payment_by_razorpay_payment_id(payment_id)
            if payment:
                await db.update_payment_record(
                    payment["razorpay_order_id"],
                    payment_status="refunded",
                    refund_id=refund_id,
                )

    return JSONResponse(status_code=200, content={"status": "ok"})
