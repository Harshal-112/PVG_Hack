// FlashSeat Web UI - Seat Grid, Live Dashboard & Security Hub
// Owned by [P5]. Built with vanilla JavaScript, zero dependencies.

(function () {
  'use strict';

  const urlParams = new URLSearchParams(window.location.search);
  const isMockMode = urlParams.get('mock') === '1';
  const EVENT_ID = urlParams.get('event') || urlParams.get('event_id') || 'evt1';
  const API_BASE = window.__API_BASE__ || localStorage.getItem('flashseat_api_base') || '/api/v1';

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

  // 2. Navigation Handling
  function initHeaderAndNavigation() {
    const navEvents = document.getElementById('nav-events');
    const navGrid = document.getElementById('nav-grid');
    const navDashboard = document.getElementById('nav-dashboard');
    const suffix = isMockMode ? '?mock=1' : '';

    const brandLink = document.querySelector('.brand-title');
    if (brandLink) brandLink.href = 'index.html' + suffix;
    if (navEvents) navEvents.href = 'events.html' + suffix;
    if (navGrid) navGrid.href = 'index.html' + suffix;
    if (navDashboard) navDashboard.href = 'dashboard.html' + suffix;

    const mockBanner = document.getElementById('mock-banner');
    if (mockBanner) mockBanner.style.display = 'none';

    const apiBadge = document.getElementById('api-mode-badge');
    if (apiBadge) {
      apiBadge.className = 'system-status-indicator';
      apiBadge.innerHTML = '<span class="status-dot"></span> System Online';
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
      const opts = { ...options };
      opts.headers = { ...(opts.headers || {}) };
      const admToken = sessionStorage.getItem('flashseat_admission_token');
      if (admToken && !opts.headers['X-Admission-Token']) {
        opts.headers['X-Admission-Token'] = admToken;
      }
      const resp = await fetch(endpoint, opts);
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
      authTabs.style.display = 'grid';
      authTitle.textContent = 'FlashSeat Security Portal';
      authSubtitle.textContent = 'High-concurrency ticket reservation engine';
    });

    tabRegisterBtn.addEventListener('click', () => {
      tabRegisterBtn.classList.add('active');
      tabLoginBtn.classList.remove('active');
      loginForm.style.display = 'none';
      registerForm.style.display = 'flex';
      mfaScreen.style.display = 'none';
      authTabs.style.display = 'grid';
      authTitle.textContent = 'Create FlashSeat Account';
      authSubtitle.textContent = 'Register to hold and confirm seats in real time';
    });

    let pendingLoginUser = null;
    let mfaExpiryInterval = null;
    let resendCooldownInterval = null;

    function stopMfaTimers() {
      if (mfaExpiryInterval) {
        clearInterval(mfaExpiryInterval);
        mfaExpiryInterval = null;
      }
      if (resendCooldownInterval) {
        clearInterval(resendCooldownInterval);
        resendCooldownInterval = null;
      }
    }

    function startMfaCountdown(expiresAtMs) {
      stopMfaTimers();
      const timerEl = document.getElementById('mfa-countdown-timer');
      const btnVerify = document.getElementById('btn-verify-mfa');
      const btnResend = document.getElementById('btn-resend-mfa');
      const resendCountEl = document.getElementById('resend-countdown-secs');

      btnVerify.disabled = false;
      btnResend.disabled = true;

      // 60-second expiration timer
      const updateExpiry = () => {
        const remainingMs = expiresAtMs - Date.now();
        const secs = Math.max(0, Math.ceil(remainingMs / 1000));
        if (timerEl) {
          timerEl.textContent = `${secs}s`;
          if (secs <= 10) {
            timerEl.classList.add('expired');
          } else {
            timerEl.classList.remove('expired');
          }
        }
        if (secs <= 0) {
          if (timerEl) timerEl.textContent = 'Expired';
          btnVerify.disabled = true;
          btnResend.disabled = false;
          if (resendCountEl) resendCountEl.textContent = '0';
          clearInterval(mfaExpiryInterval);
          mfaExpiryInterval = null;
        }
      };
      updateExpiry();
      mfaExpiryInterval = setInterval(updateExpiry, 1000);

      // 30-second resend button cooldown
      let resendSecs = 30;
      if (resendCountEl) resendCountEl.textContent = String(resendSecs);
      resendCooldownInterval = setInterval(() => {
        resendSecs -= 1;
        if (resendCountEl) resendCountEl.textContent = String(Math.max(0, resendSecs));
        if (resendSecs <= 0) {
          btnResend.disabled = false;
          clearInterval(resendCooldownInterval);
          resendCooldownInterval = null;
        }
      }, 1000);
    }

    // 1. Strict Login Form Submit
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const usernameInput = document.getElementById('login-username');
      const passwordInput = document.getElementById('login-password');
      const username = usernameInput.value.trim();
      const password = passwordInput.value;

      if (!username || username.length < 3) {
        showAlert('error', 'Invalid Input', 'Please enter a valid username (min 3 characters).');
        usernameInput.focus();
        return;
      }
      if (!password) {
        showAlert('error', 'Invalid Input', 'Please enter your password.');
        passwordInput.focus();
        return;
      }

      const btnSubmit = document.getElementById('btn-login-submit');
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Verifying...';

      const res = await apiFetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Sign In';

      if (!res.ok) {
        const errorMsg = (res.data && res.data.message) ? res.data.message : 'Invalid username or password.';
        showAlert('error', 'Authentication Failed', errorMsg);
        return;
      }

      const data = res.data;
      if (data.mfa_required) {
        // Step 2: Show Authentic MFA Screen
        pendingLoginUser = {
          user_id: data.user_id,
          username: data.username,
          totp_secret: data.totp_secret,
          expires_at_ms: data.expires_at_ms || (Date.now() + 60000)
        };

        authTabs.style.display = 'none';
        loginForm.style.display = 'none';
        registerForm.style.display = 'none';
        mfaScreen.style.display = 'flex';
        authTitle.textContent = 'Two-Factor Authentication';
        authSubtitle.textContent = 'Enter the 6-digit security code';

        const targetUserEl = document.getElementById('mfa-target-username');
        if (targetUserEl) targetUserEl.textContent = `@${data.username}`;

        const activeCodeEl = document.getElementById('mfa-active-code');
        if (activeCodeEl) activeCodeEl.textContent = data.challenge_code || '------';

        const secretKeyEl = document.getElementById('mfa-secret-key-display');
        if (secretKeyEl) secretKeyEl.textContent = data.totp_secret || 'TOTP-PROTECTED';

        // Clear previous OTP inputs
        otpInputs.forEach(i => { i.value = ''; });
        startMfaCountdown(pendingLoginUser.expires_at_ms);

        if (otpInputs[0]) otpInputs[0].focus();
      } else {
        // Direct authenticated session without MFA
        const authRecord = {
          user_id: data.user_id,
          username: data.username,
          token: data.token || ('tok-' + Date.now()),
          mfa_verified: false,
          logged_in: true,
          auth_time: Date.now()
        };
        setStoredAuthUser(authRecord);
        showAlert('success', 'Welcome Back!', `Signed in as @${data.username}. Redirecting...`);
        setTimeout(() => {
          const suffix = isMockMode ? '?mock=1' : '';
          window.location.href = 'index.html' + suffix;
        }, 800);
      }
    });

    // 2. Strict Register Form Submit (Only Username, Password & MFA Toggle)
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const usernameInput = document.getElementById('reg-username');
      const passwordInput = document.getElementById('reg-password');
      const confirmInput = document.getElementById('reg-confirm-password');

      const username = usernameInput.value.trim();
      const password = passwordInput.value;
      const confirmPassword = confirmInput.value;
      const enableMfa = document.getElementById('reg-enable-mfa').checked;

      // Strict Validation
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        showAlert('error', 'Validation Error', 'Username must be 3-20 characters long and contain only letters, numbers, or underscores.');
        usernameInput.focus();
        return;
      }
      if (password.length < 6) {
        showAlert('error', 'Validation Error', 'Password must be at least 6 characters long.');
        passwordInput.focus();
        return;
      }
      if (password !== confirmPassword) {
        showAlert('error', 'Validation Error', 'Passwords do not match. Please re-enter your password.');
        confirmInput.focus();
        return;
      }

      const btnReg = document.getElementById('btn-register-submit');
      btnReg.disabled = true;
      btnReg.textContent = 'Creating Account...';

      const res = await apiFetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, mfa_enabled: enableMfa })
      });

      btnReg.disabled = false;
      btnReg.textContent = 'Create Account';

      if (!res.ok) {
        const msg = (res.data && res.data.message) ? res.data.message : 'Registration failed.';
        showAlert('error', 'Registration Error', msg);
        return;
      }

      showAlert('success', 'Account Registered!', 'Your account has been created successfully. Please sign in.');
      tabLoginBtn.click();
      document.getElementById('login-username').value = username;
      document.getElementById('login-password').value = '';
      document.getElementById('login-password').focus();
    });

    // 3. MFA OTP Auto-Advance Input Behavior
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

    // Copy Security Code button
    const btnCopyCode = document.getElementById('btn-copy-mfa-code');
    if (btnCopyCode) {
      btnCopyCode.addEventListener('click', async () => {
        const codeText = document.getElementById('mfa-active-code').textContent.trim();
        if (codeText && codeText !== '------') {
          try {
            await navigator.clipboard.writeText(codeText);
            btnCopyCode.textContent = '✓ Copied!';
            setTimeout(() => { btnCopyCode.textContent = '📋 Copy Code'; }, 1500);
          } catch (err) {
            btnCopyCode.textContent = '✓ ' + codeText;
          }
        }
      });
    }

    // Resend MFA Code
    const btnResendMfa = document.getElementById('btn-resend-mfa');
    if (btnResendMfa) {
      btnResendMfa.addEventListener('click', async () => {
        if (!pendingLoginUser) return;
        btnResendMfa.disabled = true;

        const res = await apiFetch(`${API_BASE}/auth/resend-mfa`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: pendingLoginUser.user_id })
        });

        if (res.ok && res.data) {
          const newCode = res.data.challenge_code;
          const exp = res.data.expires_at_ms || (Date.now() + 60000);
          pendingLoginUser.expires_at_ms = exp;

          const activeCodeEl = document.getElementById('mfa-active-code');
          if (activeCodeEl) activeCodeEl.textContent = newCode;

          otpInputs.forEach(i => { i.value = ''; });
          startMfaCountdown(exp);
          showAlert('info', 'New Code Generated', 'A new 6-digit security passkey has been issued.');
          if (otpInputs[0]) otpInputs[0].focus();
        } else {
          showAlert('error', 'Error', 'Failed to resend code. Please try again.');
          btnResendMfa.disabled = false;
        }
      });
    }

    // Cancel MFA -> Back to Login
    const btnCancelMfa = document.getElementById('btn-cancel-mfa');
    if (btnCancelMfa) {
      btnCancelMfa.addEventListener('click', () => {
        stopMfaTimers();
        pendingLoginUser = null;
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
        btnVerifyMfa.textContent = 'Verifying Code...';

        const res = await apiFetch(`${API_BASE}/auth/verify-mfa`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ otp: otpCode, user_id: pendingLoginUser.user_id })
        });

        btnVerifyMfa.disabled = false;
        btnVerifyMfa.textContent = 'Verify & Sign In';

        if (!res.ok) {
          const msg = (res.data && res.data.message) ? res.data.message : 'Invalid or expired security code.';
          showAlert('error', 'Verification Failed', msg);
          otpInputs.forEach(i => { i.value = ''; });
          if (otpInputs[0]) otpInputs[0].focus();
          return;
        }

        stopMfaTimers();

        // Save authenticated session
        const authRecord = {
          user_id: pendingLoginUser.user_id,
          username: pendingLoginUser.username,
          token: (res.data && res.data.token) ? res.data.token : ('tok-' + Date.now()),
          mfa_verified: true,
          logged_in: true,
          auth_time: Date.now()
        };

        setStoredAuthUser(authRecord);
        showAlert('success', 'MFA Verified!', `Authentication successful. Access granted for @${pendingLoginUser.username}.`);

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
      btn.setAttribute('tabindex', '0');
      btn.setAttribute('aria-label', `Seat ${seatId}: FREE - $45.00 USD`);

      const idSpan = document.createElement('span');
      idSpan.className = 'seat-id';
      idSpan.textContent = seatId;

      const tagSpan = document.createElement('span');
      tagSpan.className = 'seat-state-tag';
      tagSpan.textContent = 'FREE';

      btn.appendChild(idSpan);
      btn.appendChild(tagSpan);

      btn.addEventListener('click', () => onSeatClicked(seatId));
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSeatClicked(seatId);
        }
      });

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
    const btnPayRazorpay = document.getElementById('btn-pay-razorpay');
    const paymentNotice = document.getElementById('payment-notice');

    function updateCountdown() {
      if (!activeReservation || !activeReservation.expires_at_ms) return;
      const now = Date.now();
      const remainingMs = activeReservation.expires_at_ms - now;
      const warnEl = document.getElementById('countdown-warning');
      const panelBadge = document.getElementById('panel-status-badge');

      if (remainingMs <= 0) {
        countdownTimer.textContent = '00:00 (EXPIRED)';
        countdownTimer.classList.add('expiring');
        clearInterval(countdownInterval);
        countdownInterval = null;
        if (btnConfirm) btnConfirm.disabled = true;
        if (btnPayRazorpay) btnPayRazorpay.disabled = true;
        if (panelBadge) {
          panelBadge.style.background = '#7f1d1d';
          panelBadge.style.color = '#fca5a5';
          panelBadge.textContent = 'EXPIRED';
        }
        if (warnEl) {
          warnEl.textContent = '⛔ Reservation hold has expired on the backend. Please select a new seat.';
          warnEl.style.display = 'block';
        }
        showAlert('warning', 'Hold Expired', `The hold on seat ${activeReservation.seat_id} has expired.`);
        fetchSeats();
        return;
      }

      const totalSeconds = Math.ceil(remainingMs / 1000);
      const mins = Math.floor(totalSeconds / 60);
      const secs = totalSeconds % 60;
      const formatted = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');

      countdownTimer.textContent = formatted;
      if (totalSeconds <= 30) {
        countdownTimer.classList.add('expiring');
        if (warnEl) {
          warnEl.textContent = `⚠️ Warning: Reservation expiring in ${totalSeconds}s! Confirm your booking now.`;
          warnEl.style.display = 'block';
        }
      } else {
        countdownTimer.classList.remove('expiring');
        if (warnEl) warnEl.style.display = 'none';
      }
    }

    function showActiveReservation(res) {
      activeReservation = res;
      reservationPanel.style.display = 'flex';
      detailSeatId.textContent = res.seat_id;
      detailRid.textContent = res.reservation_id;
      detailUserId.textContent = currentUserId;
      detailExpiry.textContent = new Date(res.expires_at_ms).toLocaleTimeString();
      if (btnConfirm) btnConfirm.disabled = false;
      if (btnPayRazorpay) btnPayRazorpay.disabled = false;

      const panelBadge = document.getElementById('panel-status-badge');
      if (panelBadge) {
        panelBadge.style.background = '#1e3a8a';
        panelBadge.style.color = '#93c5fd';
        panelBadge.textContent = 'HELD';
      }

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
      const warnEl = document.getElementById('countdown-warning');
      if (warnEl) warnEl.style.display = 'none';
      if (btnConfirm) btnConfirm.disabled = false;
      if (btnPayRazorpay) btnPayRazorpay.disabled = false;
      if (paymentNotice) {
        paymentNotice.style.display = 'none';
        paymentNotice.textContent = '';
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
        const rid = activeReservation.reservation_id;
        const isIdempotent = result.data && result.data.idempotent;
        recordUserBooking(seatId, rid);
        const ticketUrl = `ticket.html${isMockMode ? '?mock=1&' : '?'}event_id=${EVENT_ID}&rid=${rid}`;
        showAlert('success', 'Booking Confirmed!', `Seat ${seatId} confirmed successfully! <a href="${ticketUrl}" class="btn btn-primary btn-sm" style="margin-left: 0.5rem; text-decoration: none;">🎟️ View Digital Ticket</a>`);
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

    // Razorpay Payment Action: Create Order & Launch Checkout Modal
    if (btnPayRazorpay) {
      btnPayRazorpay.addEventListener('click', async () => {
        if (!activeReservation) return;
        btnPayRazorpay.disabled = true;
        const originalText = btnPayRazorpay.innerHTML;
        btnPayRazorpay.innerHTML = '⏳ Initializing Checkout...';
        if (paymentNotice) {
          paymentNotice.style.display = 'none';
          paymentNotice.textContent = '';
        }

        try {
          // 1. Request Razorpay order from backend
          const orderRes = await apiFetch(`${API_BASE}/payments/order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event_id: EVENT_ID,
              reservation_id: activeReservation.reservation_id,
              user_id: currentUserId
            })
          });

          if (!orderRes.ok) {
            btnPayRazorpay.disabled = false;
            btnPayRazorpay.innerHTML = originalText;
            if (orderRes.status === 410) {
              showAlert('error', 'Hold Expired', 'Your temporary hold expired before order creation. Please select a seat again.');
              hideActiveReservation();
              fetchSeats();
              return;
            }
            handleApiError(orderRes, 'Failed to create Razorpay payment order');
            return;
          }

          const orderData = orderRes.data;

          const isPlaceholderKey = !orderData.key_id || orderData.key_id.includes('placeholder');

          const onPaymentSuccess = async function (rzpResp) {
            btnPayRazorpay.innerHTML = '🔒 Verifying Payment...';
            const verifyRes = await apiFetch(`${API_BASE}/payments/verify`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event_id: EVENT_ID,
                reservation_id: activeReservation.reservation_id,
                user_id: currentUserId,
                razorpay_order_id: rzpResp.razorpay_order_id,
                razorpay_payment_id: rzpResp.razorpay_payment_id,
                razorpay_signature: rzpResp.razorpay_signature
              })
            });

            btnPayRazorpay.innerHTML = originalText;
            btnPayRazorpay.disabled = false;

            if (verifyRes.ok && verifyRes.status === 200) {
              const seatId = activeReservation.seat_id;
              const rid = activeReservation.reservation_id;
              recordUserBooking(seatId, rid);
              const ticketUrl = `ticket.html${isMockMode ? '?mock=1&' : '?'}event_id=${EVENT_ID}&rid=${rid}`;
              showAlert('success', 'Payment Successful & Confirmed!', `Seat ${seatId} confirmed via Razorpay (${rzpResp.razorpay_payment_id})! <a href="${ticketUrl}" class="btn btn-primary btn-sm" style="margin-left: 0.5rem; text-decoration: none;">🎟️ View Digital Ticket</a>`);
              hideActiveReservation();
              fetchSeats();
            } else if (verifyRes.status === 410) {
              const refundId = verifyRes.data && verifyRes.data.refund_id ? ` (Refund ID: ${verifyRes.data.refund_id})` : '';
              showAlert('error', 'Hold Expired', `Your hold expired before payment was verified. An automatic refund has been initiated${refundId}.`);
              hideActiveReservation();
              fetchSeats();
            } else {
              handleApiError(verifyRes, 'Payment verification failed');
            }
          };

          const onPaymentFailure = function (failResp) {
            btnPayRazorpay.innerHTML = originalText;
            btnPayRazorpay.disabled = false;
            const errDesc = failResp.error ? (failResp.error.description || failResp.error.code) : 'Payment failed';
            if (paymentNotice) {
              paymentNotice.textContent = `Payment failed: ${errDesc}`;
              paymentNotice.style.display = 'block';
            }
            showAlert('error', 'Payment Failed', errDesc);
          };

          const onDismiss = function () {
            btnPayRazorpay.innerHTML = originalText;
            btnPayRazorpay.disabled = false;
            if (paymentNotice) {
              paymentNotice.textContent = 'Checkout was closed. Your seat hold remains active until the countdown expires.';
              paymentNotice.style.display = 'block';
            }
          };

          function openTestCheckoutModal() {
            const modal = document.getElementById('modal-razorpay-checkout');
            const seatEl = document.getElementById('rzp-modal-seat');
            const orderEl = document.getElementById('rzp-modal-order-id');
            const amountEl = document.getElementById('rzp-modal-amount');
            const btnSuccess = document.getElementById('btn-rzp-test-success');
            const btnFail = document.getElementById('btn-rzp-test-fail');
            const btnClose = document.getElementById('btn-close-rzp-modal');

            if (!modal) {
              if (confirm(`FlashSeat Test Mode: Authorize payment of ₹${(orderData.amount / 100).toFixed(2)} for seat ${orderData.seat_id}?`)) {
                onPaymentSuccess({
                  razorpay_order_id: orderData.razorpay_order_id,
                  razorpay_payment_id: 'pay_test_' + Math.random().toString(36).substring(2, 10),
                  razorpay_signature: 'sig_test_' + Math.random().toString(36).substring(2, 12)
                });
              } else {
                onDismiss();
              }
              return;
            }

            if (seatEl) seatEl.textContent = orderData.seat_id;
            if (orderEl) orderEl.textContent = orderData.razorpay_order_id;
            if (amountEl) amountEl.textContent = `₹${(orderData.amount / 100).toFixed(2)}`;

            modal.style.display = 'flex';

            const newSuccess = btnSuccess.cloneNode(true);
            const newFail = btnFail.cloneNode(true);
            const newClose = btnClose.cloneNode(true);
            btnSuccess.parentNode.replaceChild(newSuccess, btnSuccess);
            btnFail.parentNode.replaceChild(newFail, btnFail);
            btnClose.parentNode.replaceChild(newClose, btnClose);

            newSuccess.addEventListener('click', () => {
              modal.style.display = 'none';
              onPaymentSuccess({
                razorpay_order_id: orderData.razorpay_order_id,
                razorpay_payment_id: 'pay_test_' + Math.random().toString(36).substring(2, 10),
                razorpay_signature: 'sig_test_' + Math.random().toString(36).substring(2, 12)
              });
            });

            newFail.addEventListener('click', () => {
              modal.style.display = 'none';
              onPaymentFailure({ error: { description: 'Test card payment was declined by bank simulator.' } });
            });

            newClose.addEventListener('click', () => {
              modal.style.display = 'none';
              onDismiss();
            });
          }

          // If placeholder key or Razorpay SDK is unavailable, open the interactive test modal directly
          if (isPlaceholderKey || typeof Razorpay === 'undefined') {
            openTestCheckoutModal();
            return;
          }

          // Otherwise attempt live Razorpay Checkout SDK with fallback on error
          try {
            const options = {
              key: orderData.key_id,
              amount: orderData.amount,
              currency: orderData.currency || 'INR',
              name: 'FlashSeat Arena',
              description: `Seat ${orderData.seat_id} (${EVENT_ID})`,
              order_id: orderData.razorpay_order_id,
              handler: onPaymentSuccess,
              modal: { ondismiss: onDismiss },
              prefill: {
                name: currentUserId,
                email: `${currentUserId}@example.com`,
                contact: '9999999999'
              },
              theme: { color: '#6366f1' }
            };

            const rzpInstance = new Razorpay(options);
            rzpInstance.on('payment.failed', onPaymentFailure);
            rzpInstance.open();
          } catch (sdkErr) {
            console.warn('Razorpay SDK error, falling back to test checkout modal:', sdkErr);
            openTestCheckoutModal();
          }

        } catch (err) {
          btnPayRazorpay.disabled = false;
          btnPayRazorpay.innerHTML = originalText;
          showAlert('error', 'Checkout Error', err.message);
        }
      });
    }

    // Virtual Waiting Room Queue Handler (Feature 6)
    async function handleWaitingRoomQueue() {
      const modal = document.getElementById('modal-waiting-room');
      const posEl = document.getElementById('wr-queue-position');
      const waitEl = document.getElementById('wr-est-wait');
      const btnLeave = document.getElementById('btn-leave-queue');

      if (modal) modal.style.display = 'flex';

      const joinRes = await apiFetch(`${API_BASE}/events/${EVENT_ID}/queue/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: currentUserId })
      });

      if (joinRes.data && joinRes.data.admitted) {
        if (joinRes.data.admission_token) {
          sessionStorage.setItem('flashseat_admission_token', joinRes.data.admission_token);
        }
        if (modal) modal.style.display = 'none';
        showAlert('success', 'Admission Granted!', 'You have entered the reservation arena.');
        return;
      }

      if (posEl) posEl.textContent = (joinRes.data && joinRes.data.position) ? `#${joinRes.data.position}` : 'In Line';
      if (waitEl) waitEl.textContent = (joinRes.data && joinRes.data.estimated_wait_seconds) ? `Estimated wait: ~${joinRes.data.estimated_wait_seconds}s` : 'Estimated wait: calculating...';

      const pollTimer = setInterval(async () => {
        const sRes = await apiFetch(`${API_BASE}/events/${EVENT_ID}/queue/status?user_id=${currentUserId}`);
        if (sRes.data && sRes.data.admitted) {
          clearInterval(pollTimer);
          if (sRes.data.admission_token) {
            sessionStorage.setItem('flashseat_admission_token', sRes.data.admission_token);
          }
          if (modal) modal.style.display = 'none';
          showAlert('success', 'Admitted to Arena!', 'Your turn has arrived! Select your seats now.');
        } else if (sRes.data && sRes.data.position) {
          if (posEl) posEl.textContent = `#${sRes.data.position}`;
          if (waitEl) waitEl.textContent = `Estimated wait: ~${sRes.data.estimated_wait_seconds || 10}s`;
        }
      }, 2000);

      if (btnLeave) {
        btnLeave.onclick = async () => {
          clearInterval(pollTimer);
          await apiFetch(`${API_BASE}/events/${EVENT_ID}/queue/leave`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: currentUserId })
          });
          if (modal) modal.style.display = 'none';
          showAlert('info', 'Queue Cancelled', 'You left the waiting room line.');
        };
      }
    }

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

      if (status === 403 && (errCode === 'QUEUE_ADMISSION_REQUIRED' || errMsg.includes('waiting room'))) {
        handleWaitingRoomQueue();
        return;
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
    const ctx = canvas ? canvas.getContext('2d', { willReadFrequently: true }) : null;

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

  // =========================================================================
  // TASK G: Event Discovery & Search (web/events.html) - Feature 5
  // =========================================================================
  async function initEventsPage() {
    const grid = document.getElementById('events-grid');
    const searchInput = document.getElementById('event-search-input');
    const categoryFilters = document.getElementById('event-category-filters');
    const countBadge = document.getElementById('event-count-badge');
    const btnRefresh = document.getElementById('btn-refresh-events');

    let currentCategory = '';
    let currentSearch = '';
    let debounceTimer = null;

    async function loadEvents() {
      if (grid) grid.innerHTML = '<div class="event-card-skeleton">Refreshing events and real-time inventory...</div>';

      const query = new URLSearchParams();
      if (currentSearch) query.set('search', currentSearch);
      if (currentCategory) query.set('category', currentCategory);

      const res = await apiFetch(`${API_BASE}/events?${query.toString()}`);
      if (res.error) {
        if (grid) grid.innerHTML = `<div class="event-card-skeleton" style="color: #ef4444;">Failed to load events: ${res.message || res.error}. <button class="btn btn-secondary btn-sm" id="btn-retry-events" style="margin-left: 0.5rem;">Retry</button></div>`;
        const retryBtn = document.getElementById('btn-retry-events');
        if (retryBtn) retryBtn.onclick = loadEvents;
        return;
      }

      const events = (res.data && res.data.events) ? res.data.events : [];
      if (countBadge) countBadge.textContent = events.length;

      if (!grid) return;
      if (events.length === 0) {
        grid.innerHTML = '<div class="event-card-skeleton">No events found matching your search. Try adjusting your keyword or filter.</div>';
        return;
      }

      grid.innerHTML = '';
      const suffix = isMockMode ? '?mock=1' : '';

      events.forEach(ev => {
        const card = document.createElement('div');
        card.className = 'event-card';

        const freeSeats = ev.free !== undefined ? ev.free : ev.seat_count;
        const totalSeats = ev.total !== undefined ? ev.total : ev.seat_count;
        const priceFmt = `$${(ev.price || 45).toFixed(2)} ${ev.currency || 'USD'}`;

        card.innerHTML = `
          <div>
            <div class="event-card-header">
              <h3 class="event-card-title">${ev.name}</h3>
              <span class="event-category-chip">${ev.category || 'Live Event'}</span>
            </div>
            <div class="event-card-meta" style="margin-top: 0.75rem;">
              <span>📍 ${ev.venue}</span>
              <span>📅 ${new Date(ev.date || Date.now()).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              <p style="margin-top: 0.5rem; color: var(--text-secondary); font-size: 0.88rem; line-height: 1.4;">${ev.description || ''}</p>
            </div>
          </div>
          <div>
            <div style="margin-bottom: 0.75rem;">
              <span class="event-avail-badge">🟢 ${freeSeats} / ${totalSeats} Seats Available</span>
            </div>
            <div class="event-card-footer">
              <span class="event-price-tag">${priceFmt}</span>
              <a href="index.html${suffix ? suffix + '&' : '?'}event=${ev.event_id}" class="btn btn-primary btn-sm">
                🎟️ Select Seats
              </a>
            </div>
          </div>
        `;
        grid.appendChild(card);
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          currentSearch = e.target.value.trim();
          loadEvents();
        }, 300);
      });
    }

    if (categoryFilters) {
      categoryFilters.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          categoryFilters.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          currentCategory = btn.dataset.category || '';
          loadEvents();
        });
      });
    }

    if (btnRefresh) {
      btnRefresh.addEventListener('click', loadEvents);
    }

    await loadEvents();
  }

  // =========================================================================
  // TASK H: Digital Ticket & Verification (web/ticket.html) - Feature 3
  // =========================================================================
  async function initTicketPage() {
    const loadingCard = document.getElementById('ticket-loading');
    const errorCard = document.getElementById('ticket-error');
    const passContainer = document.getElementById('ticket-pass-container');
    const btnPrint = document.getElementById('btn-print-ticket');
    const btnVerifyServer = document.getElementById('btn-verify-server');
    const serverVerifyBox = document.getElementById('server-verify-box');
    const serverVerifyDetails = document.getElementById('server-verify-details');

    const eId = urlParams.get('event_id') || urlParams.get('event') || 'evt1';
    const rid = urlParams.get('rid') || urlParams.get('reservation_id');

    if (!rid) {
      if (loadingCard) loadingCard.style.display = 'none';
      if (errorCard) {
        errorCard.style.display = 'block';
        document.getElementById('ticket-error-title').textContent = 'No Reservation ID Provided';
        document.getElementById('ticket-error-msg').textContent = 'Please specify a reservation ID or confirm a seat from the seating grid first.';
      }
      return;
    }

    const res = await apiFetch(`${API_BASE}/events/${eId}/tickets/${rid}/verify`);

    if (loadingCard) loadingCard.style.display = 'none';

    if (res.error || !res.data || !res.data.valid) {
      if (errorCard) {
        errorCard.style.display = 'block';
        document.getElementById('ticket-error-title').textContent = 'Unconfirmed or Invalid Ticket';
        document.getElementById('ticket-error-msg').textContent = res.message || 'This ticket could not be validated against confirmed backend booking logs.';
      }
      return;
    }

    const tkt = res.data;
    if (passContainer) passContainer.style.display = 'block';

    const seatEl = document.getElementById('tkt-seat-id');
    const ridEl = document.getElementById('tkt-rid');
    const codeEl = document.getElementById('tkt-code');
    const holderEl = document.getElementById('tkt-holder');

    if (seatEl) seatEl.textContent = tkt.seat_id;
    if (ridEl) ridEl.textContent = tkt.reservation_id;
    if (codeEl) codeEl.textContent = tkt.verification_code || ('TKT-' + rid.substring(0, 10).toUpperCase());

    const authUser = getStoredAuthUser();
    if (holderEl) holderEl.textContent = authUser ? authUser.username : ('Guest (' + currentUserId.substring(0, 6) + ')');

    if (btnPrint) {
      btnPrint.addEventListener('click', () => {
        window.print();
      });
    }

    if (btnVerifyServer) {
      btnVerifyServer.addEventListener('click', async () => {
        btnVerifyServer.disabled = true;
        btnVerifyServer.textContent = 'Verifying...';
        const vRes = await apiFetch(`${API_BASE}/events/${eId}/tickets/${rid}/verify`);
        btnVerifyServer.disabled = false;
        btnVerifyServer.textContent = '🛡️ Check Server Verification';

        if (serverVerifyBox) {
          serverVerifyBox.style.display = 'block';
          if (vRes.data && vRes.data.valid) {
            serverVerifyDetails.innerHTML = `
              <strong>Status:</strong> Valid Confirmed Ticket<br>
              <strong>Seat:</strong> ${vRes.data.seat_id} &bull; <strong>Ref:</strong> <code>${vRes.data.reservation_id}</code><br>
              <strong>Security Stamp:</strong> <code>${vRes.data.verification_code}</code><br>
              <strong>Server Timestamp:</strong> ${vRes.data.verified_at}
            `;
          } else {
            serverVerifyDetails.innerHTML = `<span style="color: #ef4444;">Verification Failed: ${vRes.message || 'Ticket not confirmed'}</span>`;
          }
        }
      });
    }
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
    } else if (pageType === 'events') {
      initEventsPage();
    } else if (pageType === 'ticket') {
      initTicketPage();
    }
  });
})();
