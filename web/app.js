/**
 * FlashSeat Web UI - Seat Selection & Razorpay Payment Integration
 */

(function () {
  // Configurable API base URL for deployment environments (e.g. Vercel)
  const API_BASE = window.API_BASE_URL || window.location.origin.replace(/\/ui\/?$/, '');
  const EVENT_ID = 'evt1';

  // State
  let currentUserId = localStorage.getItem('flashseat_user_id') || `u-${Math.floor(1000 + Math.random() * 9000)}`;
  localStorage.setItem('flashseat_user_id', currentUserId);

  let activeHold = null; // { reservationId, seatId, expiresAtMs, ttlMs }
  let activeOrder = null; // { paymentId, razorpayOrderId, amount, currency, keyId }
  let countdownInterval = null;
  let seatMapPollingInterval = null;

  // DOM Elements
  const userIdDisplay = document.getElementById('current-user-id');
  const switchUserBtn = document.getElementById('switch-user-btn');
  const quickReserveBtn = document.getElementById('quick-reserve-btn');
  const gridContainer = document.getElementById('grid-container');

  // Stats Counters
  const countFreeEl = document.getElementById('count-free');
  const countHeldEl = document.getElementById('count-held');
  const countSoldEl = document.getElementById('count-sold');

  // Panels
  const panelIdle = document.getElementById('panel-idle');
  const panelHeld = document.getElementById('panel-held');
  const panelProcessing = document.getElementById('panel-processing');
  const panelConfirmed = document.getElementById('panel-confirmed');
  const panelExpired = document.getElementById('panel-expired');

  // Held Panel Elements
  const summaryEvent = document.getElementById('summary-event');
  const summarySeat = document.getElementById('summary-seat');
  const summaryRid = document.getElementById('summary-rid');
  const summaryAmount = document.getElementById('summary-amount');
  const countdownTimer = document.getElementById('countdown-timer');
  const timerBarProgress = document.getElementById('timer-bar-progress');
  const payNowBtn = document.getElementById('pay-now-btn');
  const cancelHoldBtn = document.getElementById('cancel-hold-btn');
  const paymentNotice = document.getElementById('payment-notice');

  // Ticket Panel Elements
  const ticketBookingRef = document.getElementById('ticket-booking-ref');
  const ticketEvent = document.getElementById('ticket-event');
  const ticketSeat = document.getElementById('ticket-seat');
  const ticketUser = document.getElementById('ticket-user');
  const ticketAmount = document.getElementById('ticket-amount');
  const ticketPaymentId = document.getElementById('ticket-payment-id');
  const bookAnotherBtn = document.getElementById('book-another-btn');

  // Expired Panel Elements
  const expiredTitle = document.getElementById('expired-title');
  const expiredDesc = document.getElementById('expired-desc');
  const refundBox = document.getElementById('refund-box');
  const refundIdDisplay = document.getElementById('refund-id-display');
  const expiredRetryBtn = document.getElementById('expired-retry-btn');

  // Initialize
  function init() {
    userIdDisplay.textContent = currentUserId;

    switchUserBtn.addEventListener('click', onSwitchUser);
    quickReserveBtn.addEventListener('click', () => reserveSeat(null));
    payNowBtn.addEventListener('click', onPayNowClicked);
    cancelHoldBtn.addEventListener('click', onCancelHoldClicked);
    bookAnotherBtn.addEventListener('click', resetToIdle);
    expiredRetryBtn.addEventListener('click', resetToIdle);

    loadSeatMap();
    seatMapPollingInterval = setInterval(loadSeatMap, 3000);
  }

  function setView(viewName) {
    panelIdle.style.display = viewName === 'idle' ? 'block' : 'none';
    panelHeld.style.display = viewName === 'held' ? 'block' : 'none';
    panelProcessing.style.display = viewName === 'processing' ? 'block' : 'none';
    panelConfirmed.style.display = viewName === 'confirmed' ? 'block' : 'none';
    panelExpired.style.display = viewName === 'expired' ? 'block' : 'none';
  }

  function resetToIdle() {
    clearInterval(countdownInterval);
    activeHold = null;
    activeOrder = null;
    paymentNotice.style.display = 'none';
    setView('idle');
    loadSeatMap();
  }

  function onSwitchUser() {
    const input = prompt('Enter a new user ID (e.g. u-123):', currentUserId);
    if (input && input.trim()) {
      currentUserId = input.trim();
      localStorage.setItem('flashseat_user_id', currentUserId);
      userIdDisplay.textContent = currentUserId;
      resetToIdle();
    }
  }

  // Fetch and Render Seat Map
  async function loadSeatMap() {
    try {
      const resp = await fetch(`${API_BASE}/api/v1/events/${EVENT_ID}/seats`);
      if (!resp.ok) return;
      const data = await resp.json();
      const seats = data.seats || {};

      let freeCount = 0;
      let heldCount = 0;
      let soldCount = 0;

      gridContainer.innerHTML = '';

      Object.keys(seats).sort().forEach((seatId) => {
        const status = seats[seatId];
        const isMyHold = activeHold && activeHold.seatId === seatId;

        if (status === 'FREE') freeCount++;
        else if (status === 'HELD') heldCount++;
        else if (status === 'SOLD') soldCount++;

        const seatBtn = document.createElement('button');
        seatBtn.className = `seat-btn ${status.toLowerCase()}`;
        if (isMyHold) seatBtn.classList.add('my-hold');
        seatBtn.textContent = seatId;
        seatBtn.title = `Seat ${seatId} (${status})`;

        if (status === 'FREE' && !activeHold) {
          seatBtn.addEventListener('click', () => reserveSeat(seatId));
        } else if (status !== 'FREE' && !isMyHold) {
          seatBtn.disabled = true;
        }

        gridContainer.appendChild(seatBtn);
      });

      countFreeEl.textContent = freeCount;
      countHeldEl.textContent = heldCount;
      countSoldEl.textContent = soldCount;
    } catch (err) {
      console.warn('Failed to load seat map:', err);
    }
  }

  // Reserve a Seat (Specific or Any)
  async function reserveSeat(seatId) {
    if (activeHold) {
      alert('You already have an active reservation hold! Please complete or release it first.');
      return;
    }

    quickReserveBtn.disabled = true;
    quickReserveBtn.textContent = 'Reserving...';

    try {
      const resp = await fetch(`${API_BASE}/api/v1/events/${EVENT_ID}/reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: currentUserId,
          seat_id: seatId,
        }),
      });

      const data = await resp.json();

      if (resp.status === 201) {
        activeHold = {
          reservationId: data.reservation_id,
          seatId: data.seat_id,
          expiresAtMs: data.expires_at_ms,
          ttlMs: data.ttl_ms,
        };

        summaryEvent.textContent = EVENT_ID;
        summarySeat.textContent = data.seat_id;
        summaryRid.textContent = `${data.reservation_id.substring(0, 8)}...`;
        paymentNotice.style.display = 'none';

        setView('held');
        startCountdown(data.expires_at_ms, data.ttl_ms);
        loadSeatMap();
      } else {
        alert(`Reservation failed: ${data.message || data.error}`);
      }
    } catch (err) {
      alert(`Network error while reserving seat: ${err.message}`);
    } finally {
      quickReserveBtn.disabled = false;
      quickReserveBtn.textContent = '⚡ Instant Reserve Any Seat';
    }
  }

  // Reservation Expiry Countdown
  function startCountdown(expiresAtMs, ttlMs) {
    clearInterval(countdownInterval);

    function update() {
      const remainingMs = Math.max(0, expiresAtMs - Date.now());
      const totalSeconds = Math.floor(remainingMs / 1000);
      const mins = Math.floor(totalSeconds / 60);
      const secs = totalSeconds % 60;

      countdownTimer.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

      const pct = Math.max(0, Math.min(100, (remainingMs / (ttlMs || 120000)) * 100));
      timerBarProgress.style.width = `${pct}%`;

      if (totalSeconds < 30) {
        countdownTimer.classList.add('urgent');
        timerBarProgress.classList.add('urgent');
      } else {
        countdownTimer.classList.remove('urgent');
        timerBarProgress.classList.remove('urgent');
      }

      if (remainingMs <= 0) {
        clearInterval(countdownInterval);
        handleHoldExpiredLocally();
      }
    }

    update();
    countdownInterval = setInterval(update, 500);
  }

  function handleHoldExpiredLocally() {
    activeHold = null;
    activeOrder = null;
    expiredTitle.textContent = 'Hold Expired';
    expiredDesc.textContent = 'Your temporary reservation hold expired before payment was verified. The seat has been released.';
    refundBox.style.display = 'none';
    setView('expired');
    loadSeatMap();
  }

  // Cancel / Release Hold
  async function onCancelHoldClicked() {
    if (!activeHold) return;
    if (!confirm('Are you sure you want to release this seat hold?')) return;

    try {
      await fetch(`${API_BASE}/api/v1/events/${EVENT_ID}/reservations/${activeHold.reservationId}`, {
        method: 'DELETE',
      });
    } catch (e) {
      console.warn('Failed to delete reservation:', e);
    }
    resetToIdle();
  }

  // Pay Now: Create Razorpay Order & Launch Checkout Modal
  async function onPayNowClicked() {
    if (!activeHold) return;

    const btnText = payNowBtn.querySelector('.btn-text');
    const btnSpinner = payNowBtn.querySelector('.btn-spinner');

    btnText.style.display = 'none';
    btnSpinner.style.display = 'inline-block';
    payNowBtn.disabled = true;

    try {
      // 1. Request Razorpay order from backend
      const resp = await fetch(`${API_BASE}/api/v1/payments/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: EVENT_ID,
          reservation_id: activeHold.reservationId,
          user_id: currentUserId,
        }),
      });

      const orderData = await resp.json();

      if (!resp.ok) {
        if (resp.status === 410) {
          handleHoldExpiredLocally();
          return;
        }
        alert(`Order creation failed: ${orderData.message || orderData.error}`);
        btnText.style.display = 'inline-block';
        btnSpinner.style.display = 'none';
        payNowBtn.disabled = false;
        return;
      }

      activeOrder = orderData;
      summaryAmount.textContent = `₹${(orderData.amount / 100).toFixed(2)}`;

      // 2. Open Razorpay Checkout Modal
      if (typeof Razorpay === 'undefined') {
        alert('Razorpay Checkout SDK is loading or unavailable. Check your internet connection.');
        btnText.style.display = 'inline-block';
        btnSpinner.style.display = 'none';
        payNowBtn.disabled = false;
        return;
      }

      const options = {
        key: orderData.key_id,
        amount: orderData.amount,
        currency: orderData.currency,
        name: 'FlashSeat Arena',
        description: `Seat ${orderData.seat_id} (${EVENT_ID})`,
        order_id: orderData.razorpay_order_id,
        handler: async function (response) {
          // Response has razorpay_payment_id, razorpay_order_id, razorpay_signature
          await verifyPaymentWithBackend(response);
        },
        modal: {
          ondismiss: function () {
            paymentNotice.textContent = 'Checkout was closed. Your seat hold remains active until the countdown expires.';
            paymentNotice.style.display = 'block';
            btnText.style.display = 'inline-block';
            btnSpinner.style.display = 'none';
            payNowBtn.disabled = false;
          },
        },
        prefill: {
          name: currentUserId,
          email: `${currentUserId}@example.com`,
          contact: '9999999999',
        },
        theme: {
          color: '#6366f1',
        },
      };

      const rzpInstance = new Razorpay(options);
      rzpInstance.on('payment.failed', function (failResp) {
        paymentNotice.textContent = `Payment failed: ${failResp.error.description || failResp.error.code}`;
        paymentNotice.style.display = 'block';
        btnText.style.display = 'inline-block';
        btnSpinner.style.display = 'none';
        payNowBtn.disabled = false;
      });

      rzpInstance.open();
    } catch (err) {
      alert(`Checkout error: ${err.message}`);
      btnText.style.display = 'inline-block';
      btnSpinner.style.display = 'none';
      payNowBtn.disabled = false;
    }
  }

  // Verify Checkout Payment with FastAPI Backend
  async function verifyPaymentWithBackend(rzpCallback) {
    setView('processing');
    clearInterval(countdownInterval);

    try {
      const resp = await fetch(`${API_BASE}/api/v1/payments/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: EVENT_ID,
          reservation_id: activeHold.reservationId,
          user_id: currentUserId,
          razorpay_order_id: rzpCallback.razorpay_order_id,
          razorpay_payment_id: rzpCallback.razorpay_payment_id,
          razorpay_signature: rzpCallback.razorpay_signature,
        }),
      });

      const data = await resp.json();

      if (resp.status === 200) {
        // Successful booking confirmation & ticket issuance
        ticketBookingRef.textContent = data.booking_reference;
        ticketEvent.textContent = `${data.event_id} - Arena Live`;
        ticketSeat.textContent = data.seat_id;
        ticketUser.textContent = data.user_id;
        ticketAmount.textContent = `₹${(data.amount / 100).toFixed(2)}`;
        ticketPaymentId.textContent = data.payment_id;

        setView('confirmed');
        loadSeatMap();
      } else if (resp.status === 410) {
        // Hold expired: automatic refund initiated
        expiredTitle.textContent = 'Hold Expired After Payment';
        expiredDesc.textContent = data.message || 'Seat hold expired before confirmation.';
        if (data.refund_id) {
          refundIdDisplay.textContent = `Refund ID: ${data.refund_id}`;
          refundBox.style.display = 'flex';
        } else {
          refundBox.style.display = 'none';
        }
        setView('expired');
        loadSeatMap();
      } else {
        alert(`Verification failed: ${data.message || data.error}`);
        setView('held');
      }
    } catch (err) {
      alert(`Network verification error: ${err.message}. Your payment was recorded and will reconcile shortly.`);
      setView('held');
    }
  }

  // Run on page load
  document.addEventListener('DOMContentLoaded', init);
})();
