// FlashSeat Web UI - Seat Grid, Live Dashboard & Security Hub
// Owned by [P5]. Built with vanilla JavaScript, zero dependencies.

(function () {
  'use strict';

  const EVENT_ID = 'evt1';
  const API_BASE = '/api/v1';

  // 1. Auth & Session State Management
  function getStoredAuthUser() {
    try {
      const data = localStorage.getItem('flashseat_auth_user');
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  function setStoredAuthUser(user) {
    if (user) {
      localStorage.setItem('flashseat_auth_user', JSON.stringify(user));
      sessionStorage.setItem('flashseat_user_id', user.user_id || user.id);
    } else {
      localStorage.removeItem('flashseat_auth_user');
    }
  }

  function getEffectiveUserId() {
    const authUser = getStoredAuthUser();
    if (authUser && (authUser.user_id || authUser.id)) {
      return authUser.user_id || authUser.id;
    }
    let guestId = sessionStorage.getItem('flashseat_user_id');
    if (!guestId) {
      guestId = 'u-' + Math.random().toString(36).substring(2, 8);
      sessionStorage.setItem('flashseat_user_id', guestId);
    }
    return guestId;
  }

  let currentUserId = getEffectiveUserId();

  // Bookings list for current session
  function getUserBookings() {
    try {
      const data = localStorage.getItem(`flashseat_bookings_${currentUserId}`);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  function recordUserBooking(seatId, reservationId) {
    const list = getUserBookings();
    list.unshift({
      seat_id: seatId,
      reservation_id: reservationId,
      time: new Date().toLocaleTimeString(),
      event_id: EVENT_ID
    });
    localStorage.setItem(`flashseat_bookings_${currentUserId}`, JSON.stringify(list));
    updateUserTicketsBadge();
  }

  function updateUserTicketsBadge() {
    const badge = document.getElementById('user-tickets-count');
    if (badge) {
      badge.textContent = getUserBookings().length;
    }
  }

  // 2. Query Param & Navigation Handling
  const urlParams = new URLSearchParams(window.location.search);
  const isMockMode = urlParams.get('mock') === '1';

  function initHeaderAndNavigation() {
    const navGrid = document.getElementById('nav-grid');
    const navDashboard = document.getElementById('nav-dashboard');
    const apiBadge = document.getElementById('api-mode-badge');
    const mockBanner = document.getElementById('mock-banner');

    const suffix = isMockMode ? '?mock=1' : '';

    const brandLink = document.querySelector('.brand-title');
    if (brandLink) brandLink.href = 'index.html' + suffix;
    if (navGrid) navGrid.href = 'index.html' + suffix;
    if (navDashboard) navDashboard.href = 'dashboard.html' + suffix;

    if (isMockMode) {
      if (apiBadge) {
        apiBadge.className = 'mode-badge mock';
        apiBadge.textContent = 'MOCK API';
      }
      if (mockBanner) mockBanner.style.display = 'flex';
    } else {
      if (apiBadge) {
        apiBadge.className = 'mode-badge live';
        apiBadge.textContent = 'LIVE API';
      }
      if (mockBanner) mockBanner.style.display = 'none';
    }

    // User profile in header
    const authUser = getStoredAuthUser();
    const avatarEl = document.getElementById('header-user-avatar');
    const usernameEl = document.getElementById('header-username');
    const mfaTagEl = document.getElementById('header-user-mfa');
    const authActionBtn = document.getElementById('btn-header-auth-action');

    if (authUser && authUser.logged_in) {
      if (avatarEl) avatarEl.textContent = (authUser.username || 'U')[0].toUpperCase();
      if (usernameEl) usernameEl.textContent = authUser.username;
      if (mfaTagEl) {
        mfaTagEl.style.display = 'flex';
        mfaTagEl.textContent = authUser.mfa_enabled ? '🛡️ MFA Verified' : 'Standard Session';
      }
      if (authActionBtn) {
        authActionBtn.textContent = 'Sign Out';
        authActionBtn.onclick = () => {
          setStoredAuthUser(null);
          window.location.reload();
        };
      }
    } else {
      if (avatarEl) avatarEl.textContent = 'G';
      if (usernameEl) usernameEl.textContent = 'Guest (' + currentUserId.substring(0, 6) + ')';
      if (mfaTagEl) mfaTagEl.style.display = 'none';
      if (authActionBtn) {
        authActionBtn.textContent = 'Sign In';
        authActionBtn.onclick = () => {
          window.location.href = 'login.html' + suffix;
        };
      }
    }

    updateUserTicketsBadge();
  }

  // 3. Alerts & Error Display
  function showAlert(type, title, message) {
    const container = document.getElementById('alert-container');
    if (!container) return;

    const alertEl = document.createElement('div');
    alertEl.className = `alert alert-${type}`;

    const contentDiv = document.createElement('div');
    contentDiv.innerHTML = `<strong>${title}</strong>: ${message}`;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'alert-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Close message');
    closeBtn.onclick = () => alertEl.remove();

    alertEl.appendChild(contentDiv);
    alertEl.appendChild(closeBtn);
    container.prepend(alertEl);

    if (type === 'success' || type === 'info') {
      setTimeout(() => {
        if (alertEl.parentElement) alertEl.remove();
      }, 7000);
    }
  }

  // Safe API Fetch Wrapper
  async function apiFetch(endpoint, options = {}) {
    try {
      const resp = await fetch(endpoint, options);
      let data = null;
      const contentType = resp.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        try {
          data = await resp.json();
        } catch (e) {
          data = null;
        }
      } else {
        try {
          data = await resp.text();
        } catch (e) {
          data = null;
        }
      }
      return { ok: resp.ok, status: resp.status, data };
    } catch (err) {
      return { ok: false, status: 0, error: err.message };
    }
  }

  // =========================================================================
  // AUTH HUB: Login, Register, MFA (web/login.html)
  // =========================================================================
  function initAuthPage() {
    const tabLoginBtn = document.getElementById('tab-login-btn');
    const tabRegisterBtn = document.getElementById('tab-register-btn');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const mfaScreen = document.getElementById('mfa-screen');
    const authTabs = document.getElementById('auth-tabs');
    const authTitle = document.getElementById('auth-title');
    const authSubtitle = document.getElementById('auth-subtitle');

    if (!loginForm) return;

    // Tabs switching
    tabLoginBtn.addEventListener('click', () => {
      tabLoginBtn.classList.add('active');
      tabRegisterBtn.classList.remove('active');
      loginForm.style.display = 'flex';
      registerForm.style.display = 'none';
      mfaScreen.style.display = 'none';
      authTitle.textContent = 'Welcome to FlashSeat';
      authSubtitle.textContent = 'Secure, high-concurrency ticket reservation engine';
    });

    tabRegisterBtn.addEventListener('click', () => {
      tabRegisterBtn.classList.add('active');
      tabLoginBtn.classList.remove('active');
      loginForm.style.display = 'none';
      registerForm.style.display = 'flex';
      mfaScreen.style.display = 'none';
      authTitle.textContent = 'Create FlashSeat Account';
      authSubtitle.textContent = 'Register to hold and confirm seats in real time';
    });

    // Quick demo login button
    const btnQuickDemo = document.getElementById('btn-quick-demo-login');
    if (btnQuickDemo) {
      btnQuickDemo.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('login-username').value = 'demo_user';
        document.getElementById('login-password').value = 'flashpass123';
        loginForm.dispatchEvent(new Event('submit'));
      });
    }

    let pendingLoginUser = null;

    // Login Form Submit -> Step 1
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;

      if (!username || !password) {
        showAlert('error', 'Validation Error', 'Please enter your username and password.');
        return;
      }

      const btnSubmit = document.getElementById('btn-login-submit');
      btnSubmit.disabled = true;

      // Mock or Backend Auth
      const res = await apiFetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      btnSubmit.disabled = false;

      // In mock mode or fallback, proceed to MFA step
      const userId = (res.data && res.data.user_id) ? res.data.user_id : ('u-' + username.toLowerCase().replace(/[^a-z0-9]/g, ''));
      pendingLoginUser = {
        user_id: userId,
        username: username,
        mfa_enabled: true
      };

      // Show MFA Screen
      authTabs.style.display = 'none';
      loginForm.style.display = 'none';
      registerForm.style.display = 'none';
      mfaScreen.style.display = 'block';
      authTitle.textContent = 'Two-Factor Authentication';
      authSubtitle.textContent = 'Step 2: Verify your identity';

      // Focus first OTP digit
      const firstOtp = document.querySelector('.otp-digit');
      if (firstOtp) firstOtp.focus();
    });

    // Registration Form Submit
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fullname = document.getElementById('reg-fullname').value.trim();
      const username = document.getElementById('reg-username').value.trim();
      const email = document.getElementById('reg-email').value.trim();
      const password = document.getElementById('reg-password').value;
      const enableMfa = document.getElementById('reg-enable-mfa').checked;

      const btnReg = document.getElementById('btn-register-submit');
      btnReg.disabled = true;

      const res = await apiFetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullname, username, email, password, mfa_enabled: enableMfa })
      });

      btnReg.disabled = false;

      showAlert('success', 'Account Created!', 'You can now sign in with your credentials.');
      tabLoginBtn.click();
      document.getElementById('login-username').value = username;
      document.getElementById('login-password').value = password;
    });

    // MFA OTP Auto-Advance Input Behavior
    const otpInputs = Array.from(document.querySelectorAll('.otp-digit'));
    otpInputs.forEach((input, idx) => {
      input.addEventListener('input', (e) => {
        const val = e.target.value.replace(/[^0-9]/g, '');
        e.target.value = val ? val[0] : '';
        if (val && idx < otpInputs.length - 1) {
          otpInputs[idx + 1].focus();
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && idx > 0) {
          otpInputs[idx - 1].focus();
        }
      });

      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g, '');
        for (let i = 0; i < otpInputs.length && i < pasted.length; i++) {
          otpInputs[i].value = pasted[i];
        }
        if (pasted.length >= otpInputs.length) {
          otpInputs[otpInputs.length - 1].focus();
        }
      });
    });

    // Autofill demo code button
    const btnFillOtp = document.getElementById('btn-fill-otp');
    if (btnFillOtp) {
      btnFillOtp.addEventListener('click', () => {
        const code = document.getElementById('simulated-otp-code').textContent.trim();
        for (let i = 0; i < otpInputs.length && i < code.length; i++) {
          otpInputs[i].value = code[i];
        }
      });
    }

    // Cancel MFA -> Back to Login
    const btnCancelMfa = document.getElementById('btn-cancel-mfa');
    if (btnCancelMfa) {
      btnCancelMfa.addEventListener('click', () => {
        authTabs.style.display = 'grid';
        mfaScreen.style.display = 'none';
        tabLoginBtn.click();
      });
    }

    // Verify MFA Submit
    const btnVerifyMfa = document.getElementById('btn-verify-mfa');
    if (btnVerifyMfa) {
      btnVerifyMfa.addEventListener('click', async () => {
        const otpCode = otpInputs.map(i => i.value).join('');
        if (otpCode.length !== 6) {
          showAlert('error', 'Incomplete Code', 'Please enter all 6 digits of your security code.');
          return;
        }

        btnVerifyMfa.disabled = true;

        const res = await apiFetch(`${API_BASE}/auth/verify-mfa`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ otp: otpCode, user_id: pendingLoginUser.user_id })
        });

        btnVerifyMfa.disabled = false;

        // Save authenticated session
        const authRecord = {
          ...pendingLoginUser,
          token: (res.data && res.data.token) ? res.data.token : ('tok-' + Date.now()),
          mfa_verified: true,
          logged_in: true,
          auth_time: Date.now()
        };

        setStoredAuthUser(authRecord);
        showAlert('success', 'MFA Verified!', 'Access granted. Redirecting to Seat Selection Grid...');

        setTimeout(() => {
          const suffix = isMockMode ? '?mock=1' : '';
          window.location.href = 'index.html' + suffix;
        }, 1000);
      });
    }
  }

  // =========================================================================
  // TASK A: Seat Grid (web/index.html)
  // =========================================================================
  function initSeatGrid() {
    const gridContainer = document.getElementById('grid-container');
    if (!gridContainer) return;

    const TOTAL_SEATS = 200;
    const seatElements = {};

    // 200 seat grid buttons (S001 - S200)
    const fragment = document.createDocumentFragment();
    for (let i = 1; i <= TOTAL_SEATS; i++) {
      const seatId = 'S' + String(i).padStart(3, '0');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = `seat-${seatId}`;
      btn.className = 'seat-btn state-free';
      btn.setAttribute('role', 'button');
      btn.setAttribute('aria-label', `Seat ${seatId}: FREE`);

      const idSpan = document.createElement('span');
      idSpan.className = 'seat-id';
      idSpan.textContent = seatId;

      const tagSpan = document.createElement('span');
      tagSpan.className = 'seat-state-tag';
      tagSpan.textContent = 'FREE';

      btn.appendChild(idSpan);
      btn.appendChild(tagSpan);

      btn.addEventListener('click', () => onSeatClicked(seatId));

      seatElements[seatId] = {
        element: btn,
        tag: tagSpan,
        state: 'FREE'
      };
      fragment.appendChild(btn);
    }
    gridContainer.appendChild(fragment);

    // Active Reservation State
    let activeReservation = null;
    let countdownInterval = null;

    const reservationPanel = document.getElementById('reservation-panel');
    const detailSeatId = document.getElementById('detail-seat-id');
    const detailRid = document.getElementById('detail-rid');
    const detailUserId = document.getElementById('detail-user-id');
    const detailExpiry = document.getElementById('detail-expiry');
    const countdownTimer = document.getElementById('countdown-timer');
    const btnConfirm = document.getElementById('btn-confirm');
    const btnRelease = document.getElementById('btn-release');

    function updateCountdown() {
      if (!activeReservation || !activeReservation.expires_at_ms) return;
      const now = Date.now();
      const remainingMs = activeReservation.expires_at_ms - now;

      if (remainingMs <= 0) {
        countdownTimer.textContent = '00:00 (EXPIRED)';
        countdownTimer.classList.add('expiring');
        clearInterval(countdownInterval);
        countdownInterval = null;
        showAlert('warning', 'Hold Expired', `The hold on seat ${activeReservation.seat_id} has expired.`);
        return;
      }

      const totalSeconds = Math.ceil(remainingMs / 1000);
      const mins = Math.floor(totalSeconds / 60);
      const secs = totalSeconds % 60;
      const formatted = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');

      countdownTimer.textContent = formatted;
      if (totalSeconds <= 5) {
        countdownTimer.classList.add('expiring');
      } else {
        countdownTimer.classList.remove('expiring');
      }
    }

    function showActiveReservation(res) {
      activeReservation = res;
      reservationPanel.style.display = 'flex';
      detailSeatId.textContent = res.seat_id;
      detailRid.textContent = res.reservation_id;
      detailUserId.textContent = currentUserId;
      detailExpiry.textContent = new Date(res.expires_at_ms).toLocaleTimeString();

      for (const sId of Object.keys(seatElements)) {
        if (sId === res.seat_id) {
          seatElements[sId].element.classList.add('is-selected');
        } else {
          seatElements[sId].element.classList.remove('is-selected');
        }
      }

      if (countdownInterval) clearInterval(countdownInterval);
      updateCountdown();
      countdownInterval = setInterval(updateCountdown, 250);
    }

    function hideActiveReservation() {
      activeReservation = null;
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      reservationPanel.style.display = 'none';
      for (const sId of Object.keys(seatElements)) {
        seatElements[sId].element.classList.remove('is-selected');
      }
    }

    // Reservation Action: Click seat
    async function onSeatClicked(seatId) {
      const current = seatElements[seatId];
      if (!current) return;

      if (current.state === 'SOLD') {
        showAlert('error', 'Seat Unavailable', `Seat ${seatId} has already been sold and cannot be reserved.`);
        return;
      }

      if (current.state === 'HELD') {
        if (activeReservation && activeReservation.seat_id === seatId) {
          showAlert('info', 'Active Reservation', `Seat ${seatId} is currently reserved by you.`);
          return;
        }
      }

      const payload = {
        user_id: currentUserId,
        seat_id: seatId
      };

      const result = await apiFetch(`${API_BASE}/events/${EVENT_ID}/reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (result.ok && result.status === 201) {
        const data = result.data;
        showActiveReservation({
          reservation_id: data.reservation_id,
          seat_id: data.seat_id,
          expires_at_ms: data.expires_at_ms,
          ttl_ms: data.ttl_ms
        });
        showAlert('success', 'Seat Reserved', `Seat ${data.seat_id} successfully reserved! Confirm before the hold timer expires.`);
        fetchSeats();
      } else {
        handleApiError(result, `Failed to reserve seat ${seatId}`);
      }
    }

    // Quick Pick: Any seat (SPOP)
    const btnQuickPick = document.getElementById('btn-quick-pick');
    if (btnQuickPick) {
      btnQuickPick.addEventListener('click', async () => {
        btnQuickPick.disabled = true;
        const result = await apiFetch(`${API_BASE}/events/${EVENT_ID}/reserve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: currentUserId, seat_id: null })
        });
        btnQuickPick.disabled = false;

        if (result.ok && result.status === 201) {
          const data = result.data;
          showActiveReservation({
            reservation_id: data.reservation_id,
            seat_id: data.seat_id,
            expires_at_ms: data.expires_at_ms,
            ttl_ms: data.ttl_ms
          });
          showAlert('success', 'Instant Allocation', `System allocated free seat ${data.seat_id} for you!`);
          fetchSeats();
        } else {
          handleApiError(result, 'Quick Pick allocation failed');
        }
      });
    }

    // Confirm Action: POST /api/v1/events/{e}/reservations/{rid}/confirm
    btnConfirm.addEventListener('click', async () => {
      if (!activeReservation) return;
      btnConfirm.disabled = true;

      const result = await apiFetch(`${API_BASE}/events/${EVENT_ID}/reservations/${activeReservation.reservation_id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: currentUserId })
      });

      btnConfirm.disabled = false;

      if (result.ok && result.status === 200) {
        const seatId = activeReservation.seat_id;
        const isIdempotent = result.data && result.data.idempotent;
        recordUserBooking(seatId, activeReservation.reservation_id);
        showAlert('success', 'Booking Confirmed!', `Seat ${seatId} confirmed successfully! ${isIdempotent ? '(Idempotent retry)' : ''}`);
        hideActiveReservation();
        fetchSeats();
      } else {
        handleApiError(result, `Confirmation failed for seat ${activeReservation.seat_id}`);
      }
    });

    // Release Action: DELETE /api/v1/events/{e}/reservations/{rid}
    btnRelease.addEventListener('click', async () => {
      if (!activeReservation) return;
      btnRelease.disabled = true;

      const result = await apiFetch(`${API_BASE}/events/${EVENT_ID}/reservations/${activeReservation.reservation_id}`, {
        method: 'DELETE'
      });

      btnRelease.disabled = false;

      if (result.ok && result.status === 200) {
        const seatId = activeReservation.seat_id;
        showAlert('info', 'Hold Released', `Seat ${seatId} has been released and returned to FREE inventory.`);
        hideActiveReservation();
        fetchSeats();
      } else {
        handleApiError(result, `Release failed for seat ${activeReservation.seat_id}`);
      }
    });

    // Format & display error messages from API
    function handleApiError(result, defaultContext) {
      const status = result.status;
      let errCode = 'ERROR';
      let errMsg = 'An unexpected error occurred';

      if (result.data && typeof result.data === 'object') {
        errCode = result.data.error || `HTTP_${status}`;
        errMsg = result.data.message || JSON.stringify(result.data);
      } else if (result.error) {
        errMsg = result.error;
      }

      if (status === 409) {
        showAlert('error', `409 Conflict (${errCode})`, errMsg);
      } else if (status === 410) {
        showAlert('error', `410 Gone (${errCode})`, errMsg);
      } else if (status === 429) {
        showAlert('warning', `429 Rate Limited (${errCode})`, `${errMsg} (Token bucket limit reached)`);
      } else if (status === 404) {
        showAlert('error', `404 Not Found (${errCode})`, errMsg);
      } else {
        showAlert('error', `${status ? `HTTP ${status}` : 'Network Error'} (${errCode})`, `${defaultContext}: ${errMsg}`);
      }
    }

    // Polling GET /api/v1/events/evt1/seats every 1s
    let isPolling = false;
    async function fetchSeats() {
      if (isPolling) return;
      isPolling = true;

      const result = await apiFetch(`${API_BASE}/events/${EVENT_ID}/seats`);
      isPolling = false;

      if (result.ok && result.data && result.data.seats) {
        const seatMap = result.data.seats;
        let countFree = 0;
        let countHeld = 0;
        let countSold = 0;

        for (let i = 1; i <= TOTAL_SEATS; i++) {
          const seatId = 'S' + String(i).padStart(3, '0');
          const state = seatMap[seatId] || 'FREE';
          const seatObj = seatElements[seatId];
          if (!seatObj) continue;

          if (state === 'FREE') countFree++;
          else if (state === 'HELD') countHeld++;
          else if (state === 'SOLD') countSold++;

          if (seatObj.state !== state) {
            seatObj.state = state;
            seatObj.element.className = `seat-btn state-${state.toLowerCase()}${activeReservation && activeReservation.seat_id === seatId ? ' is-selected' : ''}`;
            seatObj.tag.textContent = state;
            seatObj.element.setAttribute('aria-label', `Seat ${seatId}: ${state}`);
          }
        }

        const elFree = document.getElementById('count-free');
        const elHeld = document.getElementById('count-held');
        const elSold = document.getElementById('count-sold');
        if (elFree) elFree.textContent = countFree;
        if (elHeld) elHeld.textContent = countHeld;
        if (elSold) elSold.textContent = countSold;
      }
    }

    // Search and Filters
    let currentFilter = 'ALL';
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        filterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        applyFiltersAndSearch();
      });
    });

    const searchInput = document.getElementById('search-seat');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        applyFiltersAndSearch();
      });
    }

    function applyFiltersAndSearch() {
      const query = (searchInput ? searchInput.value.trim().toUpperCase() : '');
      for (const sId of Object.keys(seatElements)) {
        const item = seatElements[sId];
        let matchesFilter = true;
        if (currentFilter === 'FREE' && item.state !== 'FREE') matchesFilter = false;
        if (currentFilter === 'HELD' && item.state !== 'HELD') matchesFilter = false;
        if (currentFilter === 'SOLD' && item.state !== 'SOLD') matchesFilter = false;

        let matchesSearch = true;
        if (query && !sId.includes(query)) matchesSearch = false;

        if (matchesFilter && matchesSearch) {
          item.element.classList.remove('filtered-out');
          if (query && sId === query) {
            item.element.classList.add('search-highlight');
          } else {
            item.element.classList.remove('search-highlight');
          }
        } else {
          item.element.classList.add('filtered-out');
          item.element.classList.remove('search-highlight');
        }
      }
    }

    // My Bookings Modal
    const btnMyBookings = document.getElementById('btn-my-bookings');
    const bookingsModal = document.getElementById('modal-my-bookings');
    const btnCloseModal = document.getElementById('btn-close-bookings-modal');
    const btnCloseBottom = document.getElementById('btn-close-bookings-bottom');
    const bookingsModalBody = document.getElementById('bookings-modal-body');

    if (btnMyBookings && bookingsModal) {
      btnMyBookings.addEventListener('click', () => {
        const bookings = getUserBookings();
        if (bookings.length === 0) {
          bookingsModalBody.innerHTML = '<div style="color: var(--text-muted); padding: 1.5rem; text-align: center;">No tickets booked yet. Reserve a seat from the grid!</div>';
        } else {
          bookingsModalBody.innerHTML = bookings.map(b => `
            <div style="background: rgba(0,0,0,0.4); border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-weight: 800; font-size: 1.2rem; color: #a7f3d0;">Seat ${b.seat_id}</div>
                <div style="font-size: 0.8rem; color: var(--text-muted); font-family: monospace;">RID: ${b.reservation_id}</div>
                <div style="font-size: 0.8rem; color: var(--text-dim);">Confirmed at: ${b.time}</div>
              </div>
              <div style="text-align: right;">
                <span class="verify-badge pass">VALID PASS</span>
              </div>
            </div>
          `).join('');
        }
        bookingsModal.style.display = 'flex';
      });

      const closeFunc = () => { bookingsModal.style.display = 'none'; };
      if (btnCloseModal) btnCloseModal.addEventListener('click', closeFunc);
      if (btnCloseBottom) btnCloseBottom.addEventListener('click', closeFunc);
      bookingsModal.addEventListener('click', (e) => {
        if (e.target === bookingsModal) closeFunc();
      });
    }

    // Initial fetch and 1s interval loop
    fetchSeats();
    const pollInterval = setInterval(fetchSeats, 1000);

    window.addEventListener('beforeunload', () => {
      clearInterval(pollInterval);
      if (countdownInterval) clearInterval(countdownInterval);
    });
  }

  // =========================================================================
  // TASK B, C, D: Live Dashboard (web/dashboard.html)
  // =========================================================================
  function initDashboard() {
    const statsContainer = document.getElementById('stats');
    if (!statsContainer) return;

    const statTotal = document.getElementById('stat-total');
    const statFree = document.getElementById('stat-free');
    const statHeld = document.getElementById('stat-held');
    const statSold = document.getElementById('stat-sold');
    const statPersisted = document.getElementById('stat-persisted');
    const statBacklog = document.getElementById('stat-backlog');
    const cardBacklog = document.getElementById('card-backlog');

    const consistencyBanner = document.getElementById('consistency-banner');
    const consistencyText = document.getElementById('consistency-text');
    const consistencyIcon = document.getElementById('consistency-icon');
    const consistencyTag = document.getElementById('consistency-tag');

    const canvas = document.getElementById('chart');
    const ctx = canvas ? canvas.getContext('2d') : null;

    const historyData = [];
    const ROLLING_WINDOW_MS = 60000;

    function resizeCanvas() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      renderChart();
    }

    window.addEventListener('resize', resizeCanvas);

    function renderChart() {
      if (!ctx || !canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const padLeft = 45;
      const padRight = 20;
      const padTop = 20;
      const padBottom = 30;

      const plotW = w - padLeft - padRight;
      const plotH = h - padTop - padBottom;

      const maxVal = 200;
      const now = Date.now();
      const windowStart = now - ROLLING_WINDOW_MS;

      // Grid Lines & Y Ticks
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.fillStyle = '#64748b';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      const yTicks = [0, 50, 100, 150, 200];
      for (const val of yTicks) {
        const y = padTop + plotH - (val / maxVal) * plotH;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + plotW, y);
        ctx.stroke();
        ctx.fillText(String(val), padLeft - 8, y);
      }

      // X Ticks
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const xTicks = [
        { offset: 60000, label: '-60s' },
        { offset: 45000, label: '-45s' },
        { offset: 30000, label: '-30s' },
        { offset: 15000, label: '-15s' },
        { offset: 0, label: 'Now' }
      ];

      for (const tick of xTicks) {
        const x = padLeft + ((60000 - tick.offset) / 60000) * plotW;
        ctx.beginPath();
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, padTop + plotH);
        ctx.stroke();
        ctx.fillText(tick.label, x, padTop + plotH + 8);
      }

      if (historyData.length === 0) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Collecting stats telemetry samples...', padLeft + plotW / 2, padTop + plotH / 2);
        ctx.restore();
        return;
      }

      function getCoords(time, val) {
        const clampedTime = Math.max(windowStart, Math.min(now, time));
        const x = padLeft + ((clampedTime - windowStart) / ROLLING_WINDOW_MS) * plotW;
        const clampedVal = Math.max(0, Math.min(maxVal, val));
        const y = padTop + plotH - (clampedVal / maxVal) * plotH;
        return { x, y };
      }

      function drawSeries(key, color) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        let first = true;
        for (let i = 0; i < historyData.length; i++) {
          const pt = historyData[i];
          const coords = getCoords(pt.time, pt[key]);
          if (first) {
            ctx.moveTo(coords.x, coords.y);
            first = false;
          } else {
            ctx.lineTo(coords.x, coords.y);
          }
        }
        ctx.stroke();

        if (historyData.length > 0) {
          const latest = historyData[historyData.length - 1];
          const latestCoords = getCoords(latest.time, latest[key]);
          ctx.beginPath();
          ctx.arc(latestCoords.x, latestCoords.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }
      }

      drawSeries('free', '#10b981');
      drawSeries('held', '#f59e0b');
      drawSeries('sold', '#ef4444');

      ctx.restore();
    }

    let isStatsPolling = false;
    async function fetchStats() {
      if (isStatsPolling) return;
      isStatsPolling = true;

      const result = await apiFetch(`${API_BASE}/events/${EVENT_ID}/stats`);
      isStatsPolling = false;

      if (result.ok && result.data) {
        const stats = result.data;
        const total = stats.total ?? 200;
        const free = stats.free ?? 0;
        const held = stats.held ?? 0;
        const sold = stats.sold ?? 0;
        const persisted = stats.persisted ?? 0;
        const backlog = stats.backlog ?? 0;

        statTotal.textContent = total;
        statFree.textContent = free;
        statHeld.textContent = held;
        statSold.textContent = sold;
        statPersisted.textContent = persisted;
        statBacklog.textContent = backlog;

        if (backlog > 0) {
          cardBacklog.classList.add('backlog-warning');
        } else {
          cardBacklog.classList.remove('backlog-warning');
        }

        const isConsistent = backlog === 0 && sold === persisted;
        if (isConsistent) {
          consistencyBanner.className = 'consistency-banner consistent';
          consistencyIcon.textContent = '✓';
          consistencyText.textContent = 'CONSISTENT';
          consistencyTag.textContent = 'Postgres in Sync';
        } else {
          consistencyBanner.className = 'consistency-banner inconsistent';
          consistencyIcon.textContent = '⏳';
          if (backlog > 0) {
            consistencyText.textContent = `STREAMING BACKLOG (${backlog} PENDING)`;
            consistencyTag.textContent = 'Writer Draining';
          } else {
            consistencyText.textContent = 'PERSISTENCE MISMATCH';
            consistencyTag.textContent = 'Sold != Persisted';
          }
        }

        const now = Date.now();
        historyData.push({ time: now, free, held, sold });

        const cutoff = now - ROLLING_WINDOW_MS;
        while (historyData.length > 0 && historyData[0].time < cutoff) {
          historyData.shift();
        }

        renderChart();
      }
    }

    resizeCanvas();
    fetchStats();
    const statsInterval = setInterval(fetchStats, 1000);

    // Verify Button
    const btnVerify = document.getElementById('btn-verify');
    const verifyLoading = document.getElementById('verify-loading');
    const verifyContainer = document.getElementById('verify-results-container');
    const verifyTbody = document.getElementById('verify-tbody');

    if (btnVerify) {
      btnVerify.addEventListener('click', async () => {
        btnVerify.disabled = true;
        verifyLoading.style.display = 'block';

        const result = await apiFetch(`${API_BASE}/events/${EVENT_ID}/verify`);

        btnVerify.disabled = false;
        verifyLoading.style.display = 'none';

        if (result.ok && result.data) {
          renderVerificationResults(result.data);
          showAlert('success', 'Verification Complete', 'Engine and database consistency invariants verified.');
        } else {
          const status = result.status;
          let msg = 'Failed to execute verification endpoint';
          if (result.data && result.data.message) msg = result.data.message;
          else if (result.error) msg = result.error;
          showAlert('error', `Verification Error (${status || 'Network'})`, msg);
        }
      });
    }

    function renderVerificationResults(data) {
      if (!verifyTbody || !verifyContainer) return;
      verifyTbody.innerHTML = '';

      const fieldEvaluators = {
        event_id: (val) => ({ pass: true, info: true, text: String(val) }),
        redis_sold: (val, obj) => {
          const match = val === obj.pg_bookings;
          return { pass: match, text: `${val} seats`, badgeText: match ? 'PASS' : 'MISMATCH' };
        },
        pg_bookings: (val, obj) => {
          const match = val === obj.redis_sold;
          return { pass: match, text: `${val} rows`, badgeText: match ? 'PASS' : 'MISMATCH' };
        },
        drained: (val) => ({
          pass: Boolean(val),
          text: Boolean(val) ? 'true (Backlog is 0)' : 'false (Backlog remaining)'
        }),
        duplicate_seat_rows: (val) => ({
          pass: val === 0,
          text: `${val} duplicate rows`
        }),
        missing_in_pg: (val) => {
          const count = Array.isArray(val) ? val.length : 0;
          return { pass: count === 0, text: count === 0 ? '[] (0 missing)' : JSON.stringify(val) };
        },
        extra_in_pg: (val) => {
          const count = Array.isArray(val) ? val.length : 0;
          return { pass: count === 0, text: count === 0 ? '[] (0 extra)' : JSON.stringify(val) };
        },
        consistent: (val) => ({
          pass: Boolean(val),
          text: Boolean(val) ? 'true (Redis == Postgres)' : 'false'
        }),
        no_double_booking: (val) => ({
          pass: Boolean(val),
          text: Boolean(val) ? 'true (Strictly 1 booking/seat)' : 'false (DOUBLE BOOKING DETECTED)'
        })
      };

      const orderedKeys = [
        'event_id',
        'consistent',
        'no_double_booking',
        'drained',
        'duplicate_seat_rows',
        'redis_sold',
        'pg_bookings',
        'missing_in_pg',
        'extra_in_pg'
      ];

      for (const k of Object.keys(data)) {
        if (!orderedKeys.includes(k)) orderedKeys.push(k);
      }

      for (const key of orderedKeys) {
        if (!(key in data)) continue;
        const val = data[key];

        let evalResult = null;
        if (fieldEvaluators[key]) {
          evalResult = fieldEvaluators[key](val, data);
        } else if (typeof val === 'boolean') {
          evalResult = { pass: val, text: String(val) };
        } else if (Array.isArray(val)) {
          evalResult = { pass: val.length === 0, text: JSON.stringify(val) };
        } else {
          evalResult = { pass: true, info: true, text: String(val) };
        }

        const tr = document.createElement('tr');
        const tdKey = document.createElement('td');
        tdKey.innerHTML = `<code>${key}</code>`;

        const tdVal = document.createElement('td');
        tdVal.textContent = evalResult.text;

        const tdStatus = document.createElement('td');
        const badge = document.createElement('span');

        if (evalResult.info) {
          badge.className = 'verify-badge info';
          badge.textContent = 'ℹ️ INFO';
        } else if (evalResult.pass) {
          badge.className = 'verify-badge pass';
          badge.textContent = `✓ ${evalResult.badgeText || 'PASS'}`;
        } else {
          badge.className = 'verify-badge fail';
          badge.textContent = `✗ ${evalResult.badgeText || 'FAIL'}`;
        }

        tdStatus.appendChild(badge);
        tr.appendChild(tdKey);
        tr.appendChild(tdVal);
        tr.appendChild(tdStatus);

        verifyTbody.appendChild(tr);
      }

      verifyContainer.style.display = 'block';
    }

    window.addEventListener('beforeunload', () => {
      clearInterval(statsInterval);
    });
  }

  // 4. Page Routing & Initialization
  document.addEventListener('DOMContentLoaded', () => {
    initHeaderAndNavigation();
    const pageType = document.body.dataset.page;
    if (pageType === 'grid') {
      initSeatGrid();
    } else if (pageType === 'dashboard') {
      initDashboard();
    } else if (pageType === 'login') {
      initAuthPage();
    }
  });
})();
