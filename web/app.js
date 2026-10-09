// FlashSeat Web UI - Seat Grid, Live Dashboard & Security Hub
// Owned by [P5]. Built with vanilla JavaScript, zero dependencies.

(function () {
  'use strict';

  const urlParams = new URLSearchParams(window.location.search);
  const isMockMode = urlParams.get('mock') === '1';
  const EVENT_ID = urlParams.get('event') || urlParams.get('event_id') || 'evt1';
  const API_BASE = window.__API_BASE__ || localStorage.getItem('flashseat_api_base') || '/api/v1';
  const TOTAL_SEATS = 200;

  // BookMyShow Movie & Event Catalog
  const MOVIE_CATALOG = {
    evt1: {
      event_id: 'evt1',
      name: 'Spider-Man: No Way Home',
      category: 'Action',
      tags: ['Action', 'Sci-Fi', 'Adventure'],
      rating: 'UA 16+',
      runtime: '148 min',
      language: 'English, Hindi',
      format: 'IMAX 2D',
      date: 'January 31, 2026',
      startTime: '11:15 AM',
      endTime: '1:45 PM',
      theater: 'Cinema 3 &bull; Dolby Atmos',
      venue: 'PVR: Inorbit Mall, Cyberabad',
      price: 450.00,
      poster: 'spiderman_poster.svg',
      shows: ['11:15 AM', '02:30 PM', '06:00 PM', '09:30 PM'],
      description: 'With Spider-Man\'s identity revealed, Peter asks Doctor Strange for help. When a spell goes wrong, multiverse foes emerge.'
    },
    evt2: {
      event_id: 'evt2',
      name: 'Dune: Part Two',
      category: 'Sci-Fi',
      tags: ['Sci-Fi', 'Adventure', 'Drama'],
      rating: 'UA 13+',
      runtime: '166 min',
      language: 'English, Hindi',
      format: 'IMAX 70mm',
      date: 'January 31, 2026',
      startTime: '02:30 PM',
      endTime: '05:15 PM',
      theater: 'Cinema 1 &bull; Grand Laser IMAX',
      venue: 'INOX: Megaplex Arena',
      price: 500.00,
      poster: 'dune_poster.svg',
      shows: ['01:00 PM', '02:30 PM', '07:00 PM', '10:30 PM'],
      description: 'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.'
    },
    evt3: {
      event_id: 'evt3',
      name: 'Deadpool & Wolverine',
      category: 'Action',
      tags: ['Action', 'Comedy', 'Superhero'],
      rating: 'A 18+',
      runtime: '128 min',
      language: 'English, Hindi, Telugu',
      format: '4DX 3D',
      date: 'January 31, 2026',
      startTime: '06:00 PM',
      endTime: '08:10 PM',
      theater: 'Cinema 2 &bull; Prime Lounge',
      venue: 'Cinepolis: Grand VIP Lounge',
      price: 480.00,
      poster: 'deadpool_poster.svg',
      shows: ['12:30 PM', '03:45 PM', '06:00 PM', '09:15 PM'],
      description: 'Wolverine is recovering from his injuries when he crosses paths with the loudmouth Deadpool to defeat a common enemy.'
    },
    evt4: {
      event_id: 'evt4',
      name: 'Oppenheimer',
      category: 'Drama',
      tags: ['Biography', 'Drama', 'History'],
      rating: 'R / UA',
      runtime: '180 min',
      language: 'English',
      format: 'IMAX 70mm',
      date: 'January 31, 2026',
      startTime: '08:30 PM',
      endTime: '11:30 PM',
      theater: 'Cinema 4 &bull; 70mm Film Dome',
      venue: 'PVR Director\'s Cut',
      price: 60.00,
      poster: 'oppenheimer_poster.svg',
      shows: ['10:45 AM', '02:45 PM', '08:30 PM'],
      description: 'The story of American scientist J. Robert Oppenheimer and his role in the development of the atomic bomb.'
    },
    evt5: {
      event_id: 'evt5',
      name: 'Interstellar (10th Anniv. IMAX)',
      category: 'Sci-Fi',
      tags: ['Sci-Fi', 'Mystery', 'Adventure'],
      rating: 'UA 13+',
      runtime: '169 min',
      language: 'English',
      format: 'IMAX 2D',
      date: 'February 01, 2026',
      startTime: '09:45 PM',
      endTime: '12:35 AM',
      theater: 'Cinema 5 &bull; Laser Audi',
      venue: 'Miraj Cinemas: IMAX Dome',
      price: 450.00,
      poster: 'interstellar_poster.svg',
      shows: ['11:00 AM', '04:00 PM', '09:45 PM'],
      description: 'When Earth becomes uninhabitable, an ex-NASA pilot is tasked with piloting a spacecraft along with a team of researchers.'
    }
  };

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
  // =========================================================================
  // TASK A: Cinema Armchair Seat Grid (CineReserve Design System)
  // =========================================================================
  function initSeatGrid() {
    const gridContainer = document.getElementById('grid-container');
    if (!gridContainer) return;

    let currentEventId = urlParams.get('event') || urlParams.get('event_id') || 'evt1';
    let currentShowtime = urlParams.get('time') || urlParams.get('showtime') || (MOVIE_CATALOG[currentEventId] && MOVIE_CATALOG[currentEventId].shows && MOVIE_CATALOG[currentEventId].shows[0]) || '11:15 AM';

    // Active Reservations Map: seatId -> { reservation_id, seat_id, seat_code, expires_at_ms, ttl_ms }
    const activeReservations = {};
    let countdownInterval = null;

    // Latest Seat States Cache from Server: seatId -> "FREE" | "HELD" | "SOLD"
    const currentSeatStates = {};
    const renderedSeatElements = {};

    // Bottom Checkout Bar Elements
    const checkoutTotalPrice = document.getElementById('checkout-total-price');
    const checkoutSeatsLabel = document.getElementById('checkout-seats-label');
    const checkoutPillsRow = document.getElementById('checkout-pills-row');
    const btnProceedBooking = document.getElementById('btn-proceed-booking');
    const btnReleaseHold = document.getElementById('btn-release-hold');

    // BMS Movie Header and Quick Switcher
    function renderMovieHeader(eventId) {
      const movie = MOVIE_CATALOG[eventId] || {
        event_id: eventId,
        name: `Event ${eventId.toUpperCase()}`,
        category: 'Live Event',
        tags: ['Featured', 'Cinema Screening'],
        rating: 'UA',
        runtime: '120 min',
        language: 'English',
        format: 'Digital 2D',
        date: 'January 31, 2026',
        startTime: '11:15 AM',
        endTime: '1:45 PM',
        theater: 'Cinema 1 &bull; Main Audi',
        venue: 'Grand Cinema Megaplex',
        price: 450.00,
        poster: 'spiderman_poster.svg',
        shows: ['11:15 AM', '02:30 PM', '06:00 PM', '09:30 PM']
      };

      const posterEl = document.getElementById('movie-poster-img');
      const titleEl = document.getElementById('movie-title-display');
      const tagsEl = document.getElementById('movie-tags-container');
      const dateEl = document.getElementById('movie-date-display');
      const startEl = document.getElementById('movie-start-display');
      const endEl = document.getElementById('movie-end-display');
      const venueEl = document.getElementById('movie-venue-display');
      const dropdownEl = document.getElementById('event-select-dropdown');
      const showtimesBox = document.getElementById('bms-showtimes-container');
      const rateBadgeEl = document.getElementById('checkout-rate-badge');

      if (posterEl) {
        posterEl.src = movie.poster;
        posterEl.alt = `${movie.name} Poster`;
      }
      if (titleEl) titleEl.textContent = movie.name;
      if (tagsEl) {
        tagsEl.innerHTML = `
          ${movie.tags.map(t => `<span class="movie-tag-pill">${t}</span>`).join('')}
          <span class="movie-meta-item">⏱️ ${movie.runtime}</span>
          <span class="movie-rating-badge">${movie.rating}</span>
        `;
      }
      if (dateEl) dateEl.textContent = movie.date;
      if (startEl) startEl.textContent = currentShowtime || movie.startTime;
      if (endEl) endEl.textContent = movie.endTime;
      if (venueEl) venueEl.innerHTML = `${movie.theater} &bull; ${movie.venue}`;
      if (rateBadgeEl) rateBadgeEl.textContent = `🏷️ ₹${movie.price.toFixed(2)} each`;

      if (dropdownEl && dropdownEl.value !== eventId) {
        dropdownEl.value = eventId;
      }

      if (showtimesBox && movie.shows) {
        showtimesBox.innerHTML = movie.shows.map(s => `
          <button type="button" class="bms-showtime-pill ${s === currentShowtime ? 'active' : ''}" data-time="${s}">${s}</button>
        `).join('');

        showtimesBox.querySelectorAll('.bms-showtime-pill').forEach(btn => {
          btn.addEventListener('click', () => {
            showtimesBox.querySelectorAll('.bms-showtime-pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentShowtime = btn.dataset.time;
            if (startEl) startEl.textContent = currentShowtime;
            showAlert('info', 'Showtime Updated', `Showtime set to ${currentShowtime} for ${movie.name}.`);
          });
        });
      }
    }

    const eventSelectDropdown = document.getElementById('event-select-dropdown');
    if (eventSelectDropdown) {
      eventSelectDropdown.addEventListener('change', (e) => {
        const newEventId = e.target.value;
        if (newEventId !== currentEventId) {
          currentEventId = newEventId;
          const movie = MOVIE_CATALOG[currentEventId];
          if (movie && movie.shows && movie.shows.length > 0) {
            currentShowtime = movie.shows[0];
          }
          for (const k of Object.keys(activeReservations)) delete activeReservations[k];
          for (const k of Object.keys(currentSeatStates)) delete currentSeatStates[k];

          const params = new URLSearchParams(window.location.search);
          params.set('event', currentEventId);
          window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);

          renderMovieHeader(currentEventId);
          renderGrid();
          updateCheckoutBar();
          fetchSeats();
          showAlert('info', 'Movie Switched', `Viewing seat layout for ${MOVIE_CATALOG[currentEventId]?.name || currentEventId}.`);
        }
      });
    }

    // Tier definitions with BMS category pricing
    const TIERS = {
      '1': { name: 'RECLINER: Rows A–E ($50)', rows: ['A', 'B', 'C', 'D', 'E'], startIdx: 1, seatsPerRow: 8, price: 450.00 },
      '2': { name: 'PRIME: Rows F–J ($35)', rows: ['F', 'G', 'H', 'I', 'J'], startIdx: 41, seatsPerRow: 8, price: 35.00 },
      '3': { name: 'CLASSIC: Rows K–O ($20)', rows: ['K', 'L', 'M', 'N', 'O'], startIdx: 81, seatsPerRow: 8, price: 20.00 },
      'all': { name: 'Full Arena (200 Seats)', rows: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'], startIdx: 1, seatsPerRow: 20, price: 450.00 }
    };

    let activeTier = '1';

    // Tier tab button listeners
    const tierTabButtons = document.querySelectorAll('.tier-tab-btn');
    tierTabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        tierTabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeTier = btn.dataset.tier || '1';
        renderGrid();
        updateLegendCounts();
        updateCheckoutBar();
      });
    });

    function renderGrid() {
      gridContainer.innerHTML = '';
      Object.keys(renderedSeatElements).forEach(k => delete renderedSeatElements[k]);

      const tierCfg = TIERS[activeTier] || TIERS['1'];
      let globalIndex = tierCfg.startIdx;

      tierCfg.rows.forEach(rowLetter => {
        const rowEl = document.createElement('div');
        rowEl.className = 'cinema-row';

        // Left Row Letter
        const leftLetter = document.createElement('div');
        leftLetter.className = 'cinema-row-letter';
        leftLetter.textContent = rowLetter;
        rowEl.appendChild(leftLetter);

        // Seats Group
        const seatsGroup = document.createElement('div');
        seatsGroup.className = 'cinema-seats-group';

        for (let s = 1; s <= tierCfg.seatsPerRow; s++) {
          const seatNum = s;
          const seatId = 'S' + String(globalIndex).padStart(3, '0');
          const seatCode = rowLetter + seatNum;
          globalIndex++;

          const btn = createSeatButton(seatId, seatCode, seatNum);
          seatsGroup.appendChild(btn);
        }

        rowEl.appendChild(seatsGroup);
        gridContainer.appendChild(rowEl);
      });

      // Synchronize visual states
      applyCurrentStatesToRendered();
    }

    function createSeatButton(seatId, seatCode, seatNum) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = `seat-${seatId}`;
      btn.className = 'seat-chair available';
      btn.setAttribute('role', 'button');
      btn.setAttribute('tabindex', '0');
      const moviePrice = (MOVIE_CATALOG[currentEventId] && MOVIE_CATALOG[currentEventId].price) || 50;
      btn.setAttribute('aria-label', `Seat ${seatCode}: Available - ₹${moviePrice.toFixed(2)}`);
      btn.setAttribute('data-seat-id', seatId);
      btn.setAttribute('data-seat-code', seatCode);

      const back = document.createElement('div');
      back.className = 'seat-chair-back';
      back.textContent = seatNum;

      const base = document.createElement('div');
      base.className = 'seat-chair-base';

      btn.appendChild(back);
      btn.appendChild(base);

      btn.addEventListener('click', () => onSeatClicked(seatId, seatCode));
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSeatClicked(seatId, seatCode);
        }
      });

      renderedSeatElements[seatId] = {
        element: btn,
        back: back,
        seatCode: seatCode,
        seatNum: seatNum
      };

      return btn;
    }

    function applyCurrentStatesToRendered() {
      for (const [seatId, item] of Object.entries(renderedSeatElements)) {
        const btn = item.element;
        let existingBadge = btn.querySelector('.seat-check-badge');

        if (activeReservations[seatId]) {
          // Seat held by current user
          btn.className = 'seat-chair selected';
          if (!existingBadge) {
            existingBadge = document.createElement('div');
            existingBadge.className = 'seat-check-badge';
            existingBadge.textContent = '✓';
            btn.appendChild(existingBadge);
          }
          btn.setAttribute('aria-label', `Seat ${item.seatCode}: Selected by you`);
        } else {
          if (existingBadge) existingBadge.remove();
          const state = currentSeatStates[seatId] || 'FREE';

          if (state === 'FREE') {
            btn.className = 'seat-chair available';
            btn.setAttribute('aria-label', `Seat ${item.seatCode}: Available`);
          } else if (state === 'HELD') {
            btn.className = 'seat-chair held';
            btn.setAttribute('aria-label', `Seat ${item.seatCode}: Held by another guest`);
          } else if (state === 'SOLD') {
            btn.className = 'seat-chair booked';
            btn.setAttribute('aria-label', `Seat ${item.seatCode}: Booked`);
          }
        }
      }
    }

    function updateCheckoutBar() {
      const heldList = Object.values(activeReservations);
      const count = heldList.length;

      if (count === 0) {
        if (checkoutTotalPrice) checkoutTotalPrice.textContent = '₹ 0.00';
        if (checkoutSeatsLabel) checkoutSeatsLabel.textContent = 'for 0 seats';
        if (checkoutPillsRow) {
          checkoutPillsRow.innerHTML = '<span style="font-size: 0.85rem; color: #64748b;">Select a seat above to reserve</span>';
        }
        if (btnProceedBooking) {
          btnProceedBooking.disabled = true;
          btnProceedBooking.textContent = 'Proceed to Booking →';
        }
        if (btnReleaseHold) {
          btnReleaseHold.style.display = 'none';
        }
        if (countdownInterval) {
          clearInterval(countdownInterval);
          countdownInterval = null;
        }
      } else {
        const movie = MOVIE_CATALOG[currentEventId];
        const unitPrice = movie ? movie.price : 450.00;
        const totalPrice = (count * unitPrice).toFixed(2); // In screenshot $20.00 for 2 seats
        if (checkoutTotalPrice) checkoutTotalPrice.textContent = `₹ ${totalPrice}`;
        if (checkoutSeatsLabel) checkoutSeatsLabel.textContent = `for ${count} ${count === 1 ? 'seat' : 'seats'}`;

        if (checkoutPillsRow) {
          const pillsHtml = heldList.map(h => `<span class="seat-pill-chip">💺 ${h.seat_code}</span>`).join(' ');
          checkoutPillsRow.innerHTML = `
            ${pillsHtml}
            <span class="rate-badge-chip" id="checkout-rate-badge">🏷️ ₹${unitPrice.toFixed(2)} each</span>
            <span class="hold-countdown-chip" id="checkout-hold-timer">⏱️ 30s</span>
          `;
        }

        if (btnProceedBooking) {
          btnProceedBooking.disabled = false;
          btnProceedBooking.textContent = 'Proceed to Booking →';
        }
        if (btnReleaseHold) {
          btnReleaseHold.style.display = 'inline-flex';
        }

        if (!countdownInterval) {
          countdownInterval = setInterval(updateCountdown, 500);
        }
        updateCountdown();
      }
    }

    function updateCountdown() {
      const heldList = Object.values(activeReservations);
      if (heldList.length === 0) return;

      const now = Date.now();
      let minRemainingMs = Infinity;

      for (const h of heldList) {
        if (h.expires_at_ms) {
          const diff = h.expires_at_ms - now;
          if (diff < minRemainingMs) minRemainingMs = diff;
        }
      }

      const timerEl = document.getElementById('checkout-hold-timer');

      if (minRemainingMs <= 0) {
        if (timerEl) timerEl.textContent = '⏱️ Expired';
        showAlert('warning', 'Hold Expired', 'Your temporary seat reservation has expired and returned to inventory.');
        for (const k of Object.keys(activeReservations)) {
          delete activeReservations[k];
        }
        updateCheckoutBar();
        applyCurrentStatesToRendered();
        fetchSeats();
        return;
      }

      const secs = Math.ceil(minRemainingMs / 1000);
      if (timerEl) timerEl.textContent = `⏱️ ${secs}s`;
    }

    async function onSeatClicked(seatId, seatCode) {
      // If already held by current user -> release it (toggle off)
      if (activeReservations[seatId]) {
        const h = activeReservations[seatId];
        delete activeReservations[seatId];
        updateCheckoutBar();
        applyCurrentStatesToRendered();
        updateLegendCounts();

        await apiFetch(`${API_BASE}/events/${currentEventId}/reservations/${h.reservation_id}`, {
          method: 'DELETE'
        });
        showAlert('info', 'Seat Deselected', `Released seat ${seatCode}.`);
        fetchSeats();
        return;
      }

      const state = currentSeatStates[seatId] || 'FREE';
      if (state === 'SOLD') {
        showAlert('error', 'Seat Booked', `Seat ${seatCode} has already been booked.`);
        return;
      }
      if (state === 'HELD') {
        showAlert('warning', 'Seat Held', `Seat ${seatCode} is currently held by another guest.`);
        return;
      }

      // Reserve seat via POST /reserve
      const admToken = sessionStorage.getItem('flashseat_admission_token');
      const payload = {
        user_id: currentUserId,
        seat_id: seatId,
        ...(admToken ? { admission_token: admToken } : {})
      };

      const result = await apiFetch(`${API_BASE}/events/${currentEventId}/reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (result.ok && result.status === 201) {
        const data = result.data;
        activeReservations[seatId] = {
          reservation_id: data.reservation_id,
          seat_id: data.seat_id,
          seat_code: seatCode,
          expires_at_ms: data.expires_at_ms,
          ttl_ms: data.ttl_ms
        };

        updateCheckoutBar();
        applyCurrentStatesToRendered();
        updateLegendCounts();
        showAlert('success', 'Seat Selected', `Seat ${seatCode} selected! Click "Proceed to Booking" to confirm.`);
        fetchSeats();
      } else {
        handleApiError(result, `Failed to hold seat ${seatCode}`);
      }
    }

    // =========================================================================
    // TASK B: Real Indian Payment Gateway Ecosystem (Razorpay, UPI & Cards)
    // =========================================================================
    const checkoutModal = document.getElementById('modal-checkout-payment');
    const btnCloseCheckout = document.getElementById('btn-close-checkout-modal');
    const gatewayMainBody = document.getElementById('gateway-main-body');
    const gatewayProcessingView = document.getElementById('gateway-processing-view');
    const gatewaySuccessView = document.getElementById('gateway-success-view');

    function closeCheckoutModal() {
      if (checkoutModal) checkoutModal.style.display = 'none';
      if (gatewayMainBody) gatewayMainBody.style.display = 'grid';
      if (gatewayProcessingView) gatewayProcessingView.style.display = 'none';
      if (gatewaySuccessView) gatewaySuccessView.style.display = 'none';
    }

    if (btnCloseCheckout) btnCloseCheckout.addEventListener('click', closeCheckoutModal);

    // Tab Navigation within Gateway
    const gatewayTabBtns = document.querySelectorAll('.gateway-tab-btn');
    gatewayTabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        gatewayTabBtns.forEach(b => {
          b.classList.remove('active');
          b.style.borderColor = 'transparent';
          b.style.background = 'transparent';
          b.style.color = '#94a3b8';
        });
        btn.classList.add('active');
        btn.style.borderColor = '#10b981';
        btn.style.background = 'rgba(16, 185, 129, 0.12)';
        btn.style.color = '#fff';

        const targetTab = btn.dataset.tab;
        document.querySelectorAll('.gateway-tab-pane').forEach(p => p.style.display = 'none');
        const activePane = document.getElementById(`gateway-tab-content-${targetTab}`);
        if (activePane) activePane.style.display = 'flex';
      });
    });

    // Quick UPI handle buttons
    document.querySelectorAll('.upi-chip-btn').forEach(chip => {
      chip.addEventListener('click', () => {
        const upiInput = document.getElementById('upi-vpa-input');
        if (upiInput) {
          const currentVal = upiInput.value.split('@')[0] || 'user';
          upiInput.value = currentVal + chip.dataset.handle;
          upiInput.focus();
        }
      });
    });

    // Open Gateway on "Proceed to Booking"
    if (btnProceedBooking) {
      btnProceedBooking.addEventListener('click', () => {
        const heldList = Object.values(activeReservations);
        if (heldList.length === 0) {
          showAlert('info', 'No Seats Selected', 'Please select at least one available seat to book.');
          return;
        }

        const movie = MOVIE_CATALOG[currentEventId] || {
          name: 'Spider-Man: No Way Home',
          price: 450.00,
          theater: 'Cinema 3',
          venue: 'PVR Megaplex'
        };

        const seatCount = heldList.length;
        const pricePerSeat = movie.price || 450.00;
        const subtotal = seatCount * pricePerSeat;
        const fee = +(subtotal * 0.10).toFixed(2);
        const totalPayable = +(subtotal + fee).toFixed(2);

        // Update amounts in UI
        const totalEl = document.getElementById('checkout-total-payable');
        const metaHdrEl = document.getElementById('gateway-movie-meta-header');
        const sumSeatsEl = document.getElementById('gateway-summary-seats');
        const sumSubEl = document.getElementById('gateway-summary-subtotal');
        const procAmtEl = document.getElementById('gateway-proc-amount');
        const succAmtEl = document.getElementById('success-amount');

        if (totalEl) totalEl.textContent = `₹${totalPayable.toFixed(2)}`;
        if (metaHdrEl) metaHdrEl.textContent = `${movie.name} • ${currentShowtime}`;
        if (sumSeatsEl) sumSeatsEl.textContent = `${seatCount} Seat${seatCount > 1 ? 's' : ''} (${heldList.map(h => h.seat_code).join(', ')})`;
        if (sumSubEl) sumSubEl.textContent = `Tickets: ₹${subtotal.toFixed(2)}`;
        if (procAmtEl) procAmtEl.textContent = `₹${totalPayable.toFixed(2)}`;
        if (succAmtEl) succAmtEl.textContent = `₹${totalPayable.toFixed(2)}`;
        const upiQrAmtEl = document.getElementById('upi-qr-amount-display');
        if (upiQrAmtEl) upiQrAmtEl.textContent = `₹${totalPayable.toFixed(2)}`;

        // Sync hold countdown in gateway
        const timerEl = document.getElementById('checkout-modal-timer');
        if (timerEl && heldList[0]) {
          const remainingSec = Math.max(0, Math.floor(((heldList[0].expires_at_ms || (Date.now() + 120000)) - Date.now()) / 1000));
          const mins = Math.floor(remainingSec / 60);
          const secs = remainingSec % 60;
          timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }

        if (gatewayMainBody) gatewayMainBody.style.display = 'grid';
        if (gatewayProcessingView) gatewayProcessingView.style.display = 'none';
        if (gatewaySuccessView) gatewaySuccessView.style.display = 'none';
        if (checkoutModal) checkoutModal.style.display = 'flex';
      });
    }

    // Unified Payment Finalizer
    async function executeGatewayPayment(paymentMethod) {
      const heldList = Object.values(activeReservations);
      if (heldList.length === 0) {
        closeCheckoutModal();
        return;
      }

      // Show processing view
      if (gatewayMainBody) gatewayMainBody.style.display = 'none';
      if (gatewayProcessingView) gatewayProcessingView.style.display = 'block';

      const procTitle = document.getElementById('gateway-proc-title');
      const procDesc = document.getElementById('gateway-proc-desc');
      const procTimer = document.getElementById('gateway-proc-timer');

      if (paymentMethod === 'upi') {
        const vpa = (document.getElementById('upi-vpa-input')?.value || 'user@okhdfcbank');
        if (procTitle) procTitle.textContent = 'Approve Request on UPI App';
        if (procDesc) procDesc.innerHTML = `Payment request sent to <strong style="color: #60a5fa;">${vpa}</strong>. Open GPay / PhonePe and approve request.`;
      } else if (paymentMethod === 'card') {
        if (procTitle) procTitle.textContent = '3D Secure Bank Verification';
        if (procDesc) procDesc.innerHTML = `Authorizing payment with issuing bank. Enter OTP sent to registered mobile.`;
      } else {
        if (procTitle) procTitle.textContent = 'Processing Payment Gateway...';
        if (procDesc) procDesc.innerHTML = `Connecting to Razorpay gateway servers and locking booking...`;
      }

      let procSecs = 298;
      const pTimerInt = setInterval(() => {
        procSecs--;
        if (procSecs <= 0) clearInterval(pTimerInt);
        const m = Math.floor(procSecs / 60);
        const s = procSecs % 60;
        if (procTimer) procTimer.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      }, 1000);

      const finishPayment = async () => {
        clearInterval(pTimerInt);
        let confirmedCount = 0;
        let lastRid = null;
        let lastSeatCode = null;
        let lastPayId = null;
        let lastBookRef = null;

        for (const h of heldList) {
          try {
            // 1. Create order on backend (app/routes/payments.py)
            const orderRes = await apiFetch(`${API_BASE}/payments/order`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event_id: currentEventId,
                reservation_id: h.reservation_id,
                user_id: currentUserId
              })
            });

            if (orderRes.ok && orderRes.data) {
              const orderData = orderRes.data;
              const mockPayId = 'pay_RZP' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
              const mockSig = 'sig_test_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);

              // 2. Verify with cryptographic HMAC backend (/api/v1/payments/verify)
              const vRes = await apiFetch(`${API_BASE}/payments/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  event_id: currentEventId,
                  reservation_id: h.reservation_id,
                  user_id: currentUserId,
                  razorpay_order_id: orderData.razorpay_order_id,
                  razorpay_payment_id: mockPayId,
                  razorpay_signature: mockSig
                })
              });

              if (vRes.ok && vRes.status === 200) {
                recordUserBooking(h.seat_id, h.reservation_id);
                confirmedCount++;
                lastRid = h.reservation_id;
                lastSeatCode = h.seat_code;
                lastPayId = mockPayId;
                lastBookRef = vRes.data?.booking_reference || ('BMS-' + Math.floor(100000 + Math.random() * 900000));
              }
            } else {
              // Direct confirm fallback
              const cRes = await apiFetch(`${API_BASE}/events/${currentEventId}/reservations/${h.reservation_id}/confirm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: currentUserId })
              });
              if (cRes.ok && cRes.status === 200) {
                recordUserBooking(h.seat_id, h.reservation_id);
                confirmedCount++;
                lastRid = h.reservation_id;
                lastSeatCode = h.seat_code;
                lastPayId = 'pay_direct_' + h.reservation_id.substring(0, 8);
                lastBookRef = 'BMS-' + Math.floor(100000 + Math.random() * 900000);
              }
            }
          } catch (err) {
            console.error('Payment processing error:', err);
          }
        }

        if (confirmedCount > 0) {
          // Transition to Success Celebration Screen
          if (gatewayProcessingView) gatewayProcessingView.style.display = 'none';
          if (gatewaySuccessView) gatewaySuccessView.style.display = 'block';

          const sPayIdEl = document.getElementById('success-pay-id');
          const sBookRefEl = document.getElementById('success-book-ref');
          if (sPayIdEl) sPayIdEl.textContent = lastPayId || 'pay_RZP984271';
          if (sBookRefEl) sBookRefEl.textContent = lastBookRef || 'BMS-84920';

          for (const k of Object.keys(activeReservations)) delete activeReservations[k];
          updateCheckoutBar();
          applyCurrentStatesToRendered();
          fetchSeats();
          updateUserTicketsBadge();

          setTimeout(() => {
            closeCheckoutModal();
            const ticketUrl = `ticket.html${isMockMode ? '?mock=1&' : '?'}event_id=${currentEventId}&rid=${lastRid}&seat=${lastSeatCode}`;
            showAlert('success', '🎉 Payment Verified & Booking Confirmed!', `Booking complete! Digital cinema pass issued.`);
            window.location.href = ticketUrl;
          }, 1400);
        } else {
          showAlert('error', 'Payment Incomplete', 'Could not verify payment with gateway. Seats may have expired.');
          closeCheckoutModal();
          fetchSeats();
        }
      };

      // Wire up instant manual approval button or auto-approve after brief realistic pause
      const autoApproveBtn = document.getElementById('btn-proc-auto-approve');
      if (autoApproveBtn) {
        autoApproveBtn.onclick = () => finishPayment();
      }
      const cancelProcBtn = document.getElementById('btn-proc-cancel');
      if (cancelProcBtn) {
        cancelProcBtn.onclick = () => {
          clearInterval(pTimerInt);
          closeCheckoutModal();
        };
      }
    }

    // Attach click listeners to gateway action buttons
    document.getElementById('btn-pay-upi')?.addEventListener('click', () => executeGatewayPayment('upi'));
    document.getElementById('btn-pay-card')?.addEventListener('click', () => executeGatewayPayment('card'));
    document.getElementById('btn-pay-nb')?.addEventListener('click', () => executeGatewayPayment('netbanking'));
    document.getElementById('btn-pay-sandbox')?.addEventListener('click', () => executeGatewayPayment('sandbox'));

    // Release button
    if (btnReleaseHold) {
      btnReleaseHold.addEventListener('click', async () => {
        const heldList = Object.values(activeReservations);
        if (heldList.length === 0) return;

        btnReleaseHold.disabled = true;
        for (const h of heldList) {
          await apiFetch(`${API_BASE}/events/${currentEventId}/reservations/${h.reservation_id}`, {
            method: 'DELETE'
          });
        }
        btnReleaseHold.disabled = false;

        for (const k of Object.keys(activeReservations)) {
          delete activeReservations[k];
        }
        updateCheckoutBar();
        applyCurrentStatesToRendered();
        updateLegendCounts();
        showAlert('info', 'Seats Released', 'All held seats have been released back to available inventory.');
        fetchSeats();
      });
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

      if (status === 403 && (errCode === 'QUEUE_ADMISSION_REQUIRED' || errMsg.includes('waiting room') || errMsg.includes('queue'))) {
        sessionStorage.removeItem('flashseat_admission_token');
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

    // Virtual Waiting Room Queue Handler (Feature 6)
    let waitingRoomPollingInterval = null;
    let admissionExpiryTimer = null;

    async function handleWaitingRoomQueue() {
      const modal = document.getElementById('modal-waiting-room');
      const badgeEl = document.getElementById('wr-event-badge');
      const posEl = document.getElementById('wr-queue-position');
      const aheadEl = document.getElementById('wr-users-ahead');
      const waitEl = document.getElementById('wr-est-wait');
      const rateEl = document.getElementById('wr-admission-rate');
      const progressBar = document.getElementById('wr-progress-bar');
      const admitBox = document.getElementById('wr-admit-box');
      const countdownEl = document.getElementById('wr-admit-countdown');
      const btnEnter = document.getElementById('btn-enter-booking');
      const btnLeave = document.getElementById('btn-leave-queue');
      const actionsRow = document.getElementById('wr-actions-row');

      if (!modal) return;
      modal.style.display = 'flex';

      if (badgeEl) {
        const evName = (currentMovie && currentMovie.name) ? currentMovie.name : currentEventId;
        badgeEl.textContent = `⚡ ${evName} (${currentEventId})`;
      }
      if (admitBox) admitBox.style.display = 'none';
      if (actionsRow) actionsRow.style.display = 'flex';

      let initialPosition = null;

      function updateUIWithPosition(pos, waitSec, usersAhead, rate) {
        if (posEl) posEl.textContent = pos ? `#${pos}` : 'In Line';
        if (aheadEl) {
          aheadEl.textContent = (pos > 1) ? `${usersAhead ?? (pos - 1)} users ahead of you` : (pos === 1 ? 'You are next in line! Getting admission pass...' : '0 users ahead in queue');
        }
        if (waitEl) waitEl.textContent = `⏱️ Estimated wait: ~${waitSec || 1}s`;
        if (rateEl && rate) rateEl.textContent = `⚡ Rate: ${rate}/sec`;

        if (!initialPosition || pos > initialPosition) {
          initialPosition = pos || 1;
        }
        const pct = Math.max(8, Math.min(95, Math.round(((initialPosition - pos + 1) / (initialPosition + 1)) * 100)));
        if (progressBar) progressBar.style.width = `${pct}%`;
      }

      function handleAdmittedSuccess(token, expiresAtMs) {
        if (waitingRoomPollingInterval) {
          clearInterval(waitingRoomPollingInterval);
          waitingRoomPollingInterval = null;
        }
        if (token) {
          sessionStorage.setItem('flashseat_admission_token', token);
        }
        if (progressBar) progressBar.style.width = '100%';
        if (posEl) posEl.textContent = 'PASS';
        if (aheadEl) aheadEl.textContent = 'Admission granted! Booking unlocked.';

        if (admitBox) admitBox.style.display = 'block';
        if (actionsRow) actionsRow.style.display = 'none';

        if (countdownEl && expiresAtMs) {
          if (admissionExpiryTimer) clearInterval(admissionExpiryTimer);
          const updateCountdown = () => {
            const remSec = Math.max(0, Math.round((expiresAtMs - Date.now()) / 1000));
            countdownEl.innerHTML = `Pass valid for: <strong style="color: #38bdf8;">${remSec}s</strong>`;
            if (remSec <= 0) {
              clearInterval(admissionExpiryTimer);
              sessionStorage.removeItem('flashseat_admission_token');
              showAlert('warning', 'Admission Expired', 'Your waiting room pass has expired. Re-joining queue...');
              handleWaitingRoomQueue();
            }
          };
          updateCountdown();
          admissionExpiryTimer = setInterval(updateCountdown, 1000);
        }

        if (btnEnter) {
          btnEnter.onclick = () => {
            modal.style.display = 'none';
            showAlert('success', 'Admission Active', 'You can now select and confirm your seats!');
          };
        }
      }

      // 1. Join queue via POST /waiting-room/join
      const joinRes = await apiFetch(`${API_BASE}/events/${currentEventId}/waiting-room/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: currentUserId })
      });

      if (joinRes.data && joinRes.data.admitted) {
        handleAdmittedSuccess(joinRes.data.admission_token, joinRes.data.expires_at_ms);
        return;
      }

      if (joinRes.data && joinRes.data.position) {
        updateUIWithPosition(
          joinRes.data.position,
          joinRes.data.estimated_wait_seconds,
          joinRes.data.users_ahead,
          joinRes.data.admission_rate_per_sec
        );
      }

      // 2. Poll status every poll_interval_ms (default 2000ms)
      if (waitingRoomPollingInterval) clearInterval(waitingRoomPollingInterval);
      const pollMs = (joinRes.data && joinRes.data.poll_interval_ms) ? joinRes.data.poll_interval_ms : 2000;

      waitingRoomPollingInterval = setInterval(async () => {
        const sRes = await apiFetch(`${API_BASE}/events/${currentEventId}/waiting-room/status?user_id=${currentUserId}`);
        if (sRes.data && sRes.data.admitted) {
          handleAdmittedSuccess(sRes.data.admission_token, sRes.data.expires_at_ms);
        } else if (sRes.data && sRes.data.position) {
          updateUIWithPosition(
            sRes.data.position,
            sRes.data.estimated_wait_seconds,
            sRes.data.users_ahead,
            sRes.data.admission_rate_per_sec
          );
        }
      }, pollMs);

      // 3. Leave button
      if (btnLeave) {
        btnLeave.onclick = async () => {
          if (waitingRoomPollingInterval) {
            clearInterval(waitingRoomPollingInterval);
            waitingRoomPollingInterval = null;
          }
          if (admissionExpiryTimer) {
            clearInterval(admissionExpiryTimer);
            admissionExpiryTimer = null;
          }
          await apiFetch(`${API_BASE}/events/${currentEventId}/waiting-room/leave`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: currentUserId })
          });
          sessionStorage.removeItem('flashseat_admission_token');
          modal.style.display = 'none';
          showAlert('info', 'Queue Departed', 'You left the waiting room line.');
        };
      }
    }

    function updateLegendCounts() {
      const elFree = document.getElementById('count-free');
      const elHeld = document.getElementById('count-held');
      const elSold = document.getElementById('count-sold');

      const tierCfg = TIERS[activeTier] || TIERS['1'];
      let free = 0;
      let held = 0;
      let sold = 0;

      const totalTierSeats = (activeTier === 'all') ? TOTAL_SEATS : (tierCfg.rows.length * tierCfg.seatsPerRow);

      for (let i = 0; i < totalTierSeats; i++) {
        const sIdx = tierCfg.startIdx + i;
        if (sIdx > TOTAL_SEATS) break;
        const seatId = 'S' + String(sIdx).padStart(3, '0');

        if (activeReservations[seatId]) {
          held++;
        } else {
          const st = currentSeatStates[seatId] || 'FREE';
          if (st === 'FREE') free++;
          else if (st === 'HELD') held++;
          else if (st === 'SOLD') sold++;
        }
      }

      if (elFree) elFree.textContent = free;
      if (elHeld) elHeld.textContent = held;
      if (elSold) elSold.textContent = sold;
    }

    // Polling GET /api/v1/events/{id}/seats every 1s
    let isPolling = false;
    async function fetchSeats() {
      if (isPolling) return;
      isPolling = true;

      const result = await apiFetch(`${API_BASE}/events/${currentEventId}/seats`);
      isPolling = false;

      if (result.ok && result.data && result.data.seats) {
        const seatMap = result.data.seats;
        for (let i = 1; i <= TOTAL_SEATS; i++) {
          const sId = 'S' + String(i).padStart(3, '0');
          currentSeatStates[sId] = seatMap[sId] || 'FREE';
        }

        applyCurrentStatesToRendered();
        updateLegendCounts();
      }
    }

    // My Bookings Modal
    const btnMyBookings = document.getElementById('btn-my-bookings');
    const bookingsModal = document.getElementById('modal-my-bookings');
    const btnCloseModal = document.getElementById('btn-close-bookings-modal');
    const btnCloseBottom = document.getElementById('btn-close-bookings-bottom');
    const bookingsModalBody = document.getElementById('bookings-modal-body');

    if (btnMyBookings && bookingsModal) {
      btnMyBookings.addEventListener('click', (e) => {
        e.preventDefault();
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

    // Initial render and polling
    renderMovieHeader(currentEventId);
    renderGrid();
    updateCheckoutBar();
    fetchSeats();

    // Check if waiting room is active and whether admission is required
    (async function checkWaitingRoomOnLoad() {
      const res = await apiFetch(`${API_BASE}/events/${currentEventId}/waiting-room/status?user_id=${currentUserId}`);
      if (res.ok && res.data && res.data.enabled) {
        if (res.data.admitted && res.data.admission_token) {
          sessionStorage.setItem('flashseat_admission_token', res.data.admission_token);
        } else if (!res.data.admitted) {
          handleWaitingRoomQueue();
        }
      }
    })();

    const pollInterval = setInterval(fetchSeats, 1000);

    window.addEventListener('beforeunload', () => {
      clearInterval(pollInterval);
      if (countdownInterval) clearInterval(countdownInterval);
      if (waitingRoomPollingInterval) clearInterval(waitingRoomPollingInterval);
      if (admissionExpiryTimer) clearInterval(admissionExpiryTimer);
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
      await fetchWaitingRoomStats();
    }

    async function fetchWaitingRoomStats() {
      const wrPill = document.getElementById('wr-status-pill');
      const wrQueue = document.getElementById('wr-stat-queue');
      const wrQueueSub = document.getElementById('wr-stat-queue-sub');
      const wrAdmitted = document.getElementById('wr-stat-admitted');
      const wrAdmittedSub = document.getElementById('wr-stat-admitted-sub');
      const wrRate = document.getElementById('wr-stat-rate');
      const wrTotal = document.getElementById('wr-stat-total-admitted');
      const wrTtl = document.getElementById('wr-stat-token-ttl');
      const wrDepartures = document.getElementById('wr-stat-departures');
      const wrDeparturesSub = document.getElementById('wr-stat-departures-sub');
      const wrPollInterval = document.getElementById('wr-poll-interval');

      if (!wrQueue) return;

      const res = await apiFetch(`${API_BASE}/events/${EVENT_ID}/waiting-room/stats`);
      if (res.ok && res.data) {
        const d = res.data;
        const isEnabled = Boolean(d.enabled);
        if (wrPill) {
          wrPill.textContent = isEnabled ? 'ACTIVE' : 'BYPASS';
          wrPill.className = `wr-status-pill ${isEnabled ? 'active' : 'bypass'}`;
        }
        if (wrPollInterval && d.poll_interval_ms) wrPollInterval.textContent = `${Number(d.poll_interval_ms).toLocaleString()}ms`;
        if (wrQueue) wrQueue.textContent = d.waiting_count ?? 0;
        if (wrQueueSub) wrQueueSub.textContent = `${d.waiting_count ?? 0} users in FIFO queue (avg wait: ~${d.avg_wait_seconds ?? 0}s)`;
        if (wrAdmitted) wrAdmitted.textContent = d.admitted_count ?? 0;
        if (wrAdmittedSub) wrAdmittedSub.textContent = `Capacity: ${d.admitted_count ?? 0} / ${d.max_admitted ?? 50} sessions`;
        if (wrRate) wrRate.textContent = `${d.admission_rate_per_sec ?? 10}/s`;
        if (wrTotal) wrTotal.textContent = d.admissions_total ?? 0;
        if (wrTtl) wrTtl.textContent = `${d.token_ttl_sec ?? 120}s`;
        if (wrDepartures) wrDepartures.textContent = `${d.left_total ?? 0} / ${d.expired_total ?? 0}`;
        if (wrDeparturesSub) wrDeparturesSub.textContent = `${d.left_total ?? 0} left / ${d.expired_total ?? 0} expired holds`;
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
          badge.textContent = `✕ ${evalResult.badgeText || 'FAIL'}`;
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
        card.className = 'event-card bms-movie-card';

        const freeSeats = ev.free !== undefined ? ev.free : ev.seat_count;
        const totalSeats = ev.total !== undefined ? ev.total : ev.seat_count;
        const movieMeta = MOVIE_CATALOG[ev.event_id] || {
          name: ev.name,
          poster: 'spiderman_poster.svg',
          rating: 'UA',
          format: '2D',
          runtime: '120 min',
          language: 'English',
          theater: 'Cinema Audi',
          venue: ev.venue || 'Grand Megaplex',
          price: ev.price || 50.00,
          shows: ['11:15 AM', '02:30 PM', '06:00 PM', '09:30 PM'],
          description: ev.description || '',
          tags: [ev.category || 'Movie']
        };

        const movieTitle = ev.name || movieMeta.name;
        const priceVal = ev.price || movieMeta.price || 450;
        const priceFmt = `₹${priceVal.toFixed(2)}`;
        const posterImg = ev.poster || movieMeta.poster;
        const formatTag = ev.format || movieMeta.format;
        const ratingTag = ev.rating || movieMeta.rating;
        const runtimeTag = ev.runtime || movieMeta.runtime;
        const languageTag = ev.language || movieMeta.language;
        const venueText = ev.venue || movieMeta.venue;
        const theaterText = movieMeta.theater ? `${movieMeta.theater} &bull; ` : '';
        const showsList = ev.shows || movieMeta.shows || ['11:15 AM', '02:30 PM', '06:00 PM'];
        const tagsList = ev.tags || movieMeta.tags || [ev.category || 'Movie'];

        card.innerHTML = `
          <div class="bms-card-top">
            <div class="bms-card-poster">
              <img src="${posterImg}" alt="${movieTitle} Poster" onerror="this.src='spiderman_poster.svg'">
              <span class="bms-card-format-tag">${formatTag}</span>
            </div>
            <div class="bms-card-details">
              <div class="bms-card-header">
                <h3 class="bms-card-title">${movieTitle}</h3>
                <span class="movie-rating-badge">${ratingTag}</span>
              </div>
              <div class="movie-pill-tags" style="margin: 0.25rem 0;">
                ${tagsList.map(t => `<span class="movie-tag-pill">${t}</span>`).join('')}
              </div>
              <div class="bms-card-meta-row">
                <span>📍 ${theaterText}${venueText}</span>
                <span>⏱️ ${runtimeTag} &bull; 🌐 ${languageTag}</span>
              </div>
              <p class="bms-card-desc">${ev.description || movieMeta.description}</p>
            </div>
          </div>

          <div class="bms-card-showtimes-row">
            <span class="bms-showtime-label">Showtimes:</span>
            <div class="bms-showtime-pills">
              ${showsList.map(s => `
                <a href="index.html${suffix ? suffix + '&' : '?'}event=${ev.event_id}&time=${encodeURIComponent(s)}" class="bms-showtime-pill">
                  ${s}
                </a>
              `).join('')}
            </div>
          </div>

          <div class="bms-card-footer">
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <span class="event-avail-badge">🟢 ${freeSeats} / ${totalSeats} Seats</span>
              <span class="event-price-tag">${priceFmt}</span>
            </div>
            <a href="index.html${suffix ? suffix + '&' : '?'}event=${ev.event_id}" class="btn btn-primary btn-sm">
              🎟️ Select Seats &rarr;
            </a>
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

    // Generate Authoritative Scannable QR Code using QRCode library
    const qrBox = document.getElementById('ticket-qr-box');
    if (qrBox) {
      qrBox.innerHTML = '';
      const verifyUrl = `${window.location.origin}/ui/ticket.html?event_id=${eId}&rid=${rid}&seat=${tkt.seat_id || ''}`;
      if (typeof QRCode !== 'undefined') {
        new QRCode(qrBox, {
          text: verifyUrl,
          width: 130,
          height: 130,
          colorDark: '#000000',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
      }
    }
    if (ridEl) ridEl.textContent = tkt.reservation_id;
    if (codeEl) codeEl.textContent = tkt.verification_code || ('TKT-' + rid.substring(0, 10).toUpperCase());

    const movie = MOVIE_CATALOG[eId];
    if (movie) {
      const evNameEl = document.getElementById('tkt-event-name');
      const evVenueEl = document.getElementById('tkt-venue');
      const evDateEl = document.getElementById('tkt-date');
      if (evNameEl) evNameEl.textContent = movie.name;
      if (evVenueEl) evVenueEl.innerHTML = `${movie.theater} &bull; ${movie.venue}`;
      if (evDateEl) evDateEl.innerHTML = `${movie.date} &bull; ${movie.startTime}`;
    }

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
