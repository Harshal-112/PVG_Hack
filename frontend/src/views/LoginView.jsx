import React, { useState, useEffect, useRef } from 'react';
import { 
  Zap, 
  Mail, 
  ArrowRight, 
  ShieldCheck, 
  Shield,
  CheckCircle2,
  ArrowLeft,
  RefreshCw,
  Check,
  AlertCircle,
  Clock,
  Sparkles
} from 'lucide-react';

export default function LoginView({ onLoginSuccess, onCancel }) {
  // Step state: 'initial' (Google + Email input) | 'otp_verify' | 'success'
  const [step, setStep] = useState('initial');
  
  // Email and challenge states
  const [email, setEmail] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  
  // UI / request states
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  
  // Timers
  const [expiresInSeconds, setExpiresInSeconds] = useState(300); // 5 minutes TTL
  const [cooldownSeconds, setCooldownSeconds] = useState(0);    // 60 seconds resend cooldown
  
  const inputRefs = useRef([]);

  // Base API URL helper
  const getApiUrl = (endpoint) => {
    let base = '';
    if (typeof window !== 'undefined') {
      if (window.__API_BASE__) base = window.__API_BASE__;
      else if (localStorage.getItem('flashseat_api_base')) base = localStorage.getItem('flashseat_api_base');
    }
    const cleanBase = base.replace(/\/+$/, '');
    const cleanEndpoint = endpoint.replace(/^\/+/, '');
    return cleanBase ? `${cleanBase}/${cleanEndpoint}` : `/${cleanEndpoint}`;
  };

  // Expiration countdown effect
  useEffect(() => {
    if (step !== 'otp_verify' || expiresInSeconds <= 0) return;
    const interval = setInterval(() => {
      setExpiresInSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [step, expiresInSeconds]);

  // Resend cooldown countdown effect
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const interval = setInterval(() => {
      setCooldownSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldownSeconds]);

  // Format seconds as MM:SS
  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Google SVG Logo Icon
  const GoogleIcon = () => (
    <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // OPTION A: Continue with Google
  // ─────────────────────────────────────────────────────────────────────────────
  const handleGoogleSignIn = async () => {
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      // In web app, we initiate Google OAuth redirection via backend
      const loginUrl = getApiUrl('api/v1/auth/google/login?mode=json');
      const res = await fetch(loginUrl, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.auth_url) {
          window.location.href = data.auth_url;
          return;
        }
      }
    } catch {
      // If backend not directly accessible from preview client, fallback to Google login route
    }

    // Direct redirect to Google OAuth login endpoint
    window.location.href = getApiUrl('api/v1/auth/google/login');
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // OPTION B: Send Email OTP (Step 1)
  // ─────────────────────────────────────────────────────────────────────────────
  const handleSendOtp = async (e) => {
    e?.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    setLoading(true);

    try {
      const endpoint = getApiUrl('api/v1/auth/email/send-otp');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail }),
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to send verification code.');
      }

      setChallengeId(data.challenge_id);
      setExpiresInSeconds(data.expires_in_seconds || 300);
      setCooldownSeconds(data.cooldown_seconds || 60);
      setOtp(['', '', '', '', '', '']);
      setStep('otp_verify');
      setSuccessMessage(`Verification code sent to ${cleanEmail}`);
    } catch (err) {
      setErrorMessage(err.message || 'Unable to connect to authentication service.');
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Resend OTP Action
  // ─────────────────────────────────────────────────────────────────────────────
  const handleResendOtp = async () => {
    if (cooldownSeconds > 0 || resending) return;
    setErrorMessage('');
    setSuccessMessage('');
    setResending(true);

    try {
      const endpoint = getApiUrl('api/v1/auth/email/send-otp');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to resend code.');
      }

      setChallengeId(data.challenge_id);
      setExpiresInSeconds(data.expires_in_seconds || 300);
      setCooldownSeconds(data.cooldown_seconds || 60);
      setOtp(['', '', '', '', '', '']);
      setSuccessMessage('A fresh verification code has been sent to your email.');
    } catch (err) {
      setErrorMessage(err.message || 'Failed to resend code.');
    } finally {
      setResending(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // OTP Digit Box Navigation
  // ─────────────────────────────────────────────────────────────────────────────
  const handleOtpChange = (index, value) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);
    setErrorMessage('');

    // Advance to next box automatically
    if (value && index < 5 && inputRefs.current[index + 1]) {
      inputRefs.current[index + 1].focus();
    }
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0 && inputRefs.current[index - 1]) {
      inputRefs.current[index - 1].focus();
    }
  };

  const handleOtpPaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').trim();
    if (/^\d{6}$/.test(pasted)) {
      const digits = pasted.split('');
      setOtp(digits);
      setErrorMessage('');
      if (inputRefs.current[5]) inputRefs.current[5].focus();
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // OPTION B: Verify OTP & Continue (Step 2)
  // ─────────────────────────────────────────────────────────────────────────────
  const handleVerifyOtp = async (e) => {
    e?.preventDefault();
    setErrorMessage('');
    const fullOtp = otp.join('');

    if (fullOtp.length !== 6) {
      setErrorMessage('Please enter all 6 verification digits.');
      return;
    }

    if (expiresInSeconds <= 0) {
      setErrorMessage('This verification code has expired. Please click Resend Code.');
      return;
    }

    setLoading(true);

    try {
      const endpoint = getApiUrl('api/v1/auth/email/verify-otp');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_id: challengeId,
          email: email.trim().toLowerCase(),
          otp: fullOtp,
        }),
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Verification failed.');
      }

      setStep('success');

      // Prepare verified user profile
      const verifiedUser = {
        id: data.user?.id || `usr_${Date.now()}`,
        name: data.user?.display_name || email.split('@')[0],
        email: data.user?.email || email,
        initials: (data.user?.display_name || email).substring(0, 2).toUpperCase(),
        provider: 'email_otp',
        sessionToken: data.session_token,
        isVerified: true,
        verifiedAt: new Date().toISOString(),
      };

      setTimeout(() => {
        onLoginSuccess(verifiedUser);
      }, 700);
    } catch (err) {
      setErrorMessage(err.message || 'Incorrect verification code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden transition-all animate-fadeIn">
      
      {/* ─────────────────────────────────────────────────────────────
          STEP 1: INITIAL LOGIN (Continue with Google + Email OTP)
      ───────────────────────────────────────────────────────────── */}
      {step === 'initial' && (
        <div className="p-8 space-y-6">
          
          {/* FlashSeat Header & Branding */}
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center mx-auto text-indigo-400 shadow-lg shadow-indigo-500/10">
              <Zap className="w-6 h-6 fill-current" />
            </div>
            <h2 className="text-2xl font-black text-white tracking-tight">
              FlashSeat
            </h2>
            <p className="text-xs text-slate-400 font-medium">
              High-concurrency ticket reservation engine
            </p>
          </div>

          {/* Feedback Messages */}
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Option A: Continue with Google Button */}
          <div>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-900 text-sm font-bold shadow-md transition-all flex items-center justify-center gap-3 cursor-pointer disabled:opacity-50"
            >
              <GoogleIcon />
              <span>Continue with Google</span>
            </button>
          </div>

          {/* Divider: OR */}
          <div className="relative flex items-center justify-center my-4">
            <div className="border-t border-slate-800 w-full" />
            <span className="bg-slate-900 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-widest absolute">
              OR
            </span>
          </div>

          {/* Option B: Continue with Email Form */}
          <form onSubmit={handleSendOtp} className="space-y-4">
            <div>
              <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block mb-1.5">
                Email address
              </label>
              <div className="relative">
                <input
                  type="email"
                  placeholder="Enter your email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-sm font-medium text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                  autoFocus
                  required
                />
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-sm font-bold shadow-lg shadow-indigo-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Sending Code...</span>
                </>
              ) : (
                <>
                  <span>Send Verification Code</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Security Notice Footer */}
          <div className="pt-2 text-center">
            <p className="text-[11px] text-slate-500 flex items-center justify-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-slate-400" />
              <span>Zero-plaintext OTP &bull; Verified Server Identity</span>
            </p>
          </div>

        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          STEP 2: OTP VERIFICATION SCREEN
      ───────────────────────────────────────────────────────────── */}
      {step === 'otp_verify' && (
        <div className="p-8 space-y-6 animate-fadeIn">
          
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center mx-auto text-indigo-400 shadow-lg shadow-indigo-500/10">
              <Mail className="w-6 h-6" />
            </div>
            
            <h3 className="text-xl font-black text-white tracking-tight">
              Enter the verification code sent to your email.
            </h3>
            
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>{email}</span>
            </div>
          </div>

          {/* Alerts */}
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Expiration Timer Indicator */}
          <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
              <span>Code expires in:</span>
            </span>
            <span className={`font-mono font-bold ${expiresInSeconds < 60 ? 'text-rose-400' : 'text-slate-200'}`}>
              {formatTime(expiresInSeconds)}
            </span>
          </div>

          {/* 6-Digit OTP Inputs: [ _ _ _ _ _ _ ] */}
          <form onSubmit={handleVerifyOtp} className="space-y-5">
            <div className="flex items-center justify-between gap-2" onPaste={handleOtpPaste}>
              {otp.map((digit, idx) => (
                <input
                  key={idx}
                  ref={(el) => (inputRefs.current[idx] = el)}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpChange(idx, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(idx, e.target.value ? e : e)}
                  disabled={loading}
                  className="w-12 h-14 text-center text-xl font-mono font-black text-white bg-slate-800 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all shadow-inner"
                  autoFocus={idx === 0}
                />
              ))}
            </div>

            {/* Verify & Continue Button */}
            <button
              type="submit"
              disabled={loading || otp.join('').length !== 6 || expiresInSeconds <= 0}
              className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-sm font-bold shadow-lg shadow-indigo-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Verify &amp; Continue</span>
                </>
              )}
            </button>

            {/* Resend Code Action with Cooldown */}
            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={cooldownSeconds > 0 || resending}
                className="text-xs font-bold text-indigo-400 hover:text-indigo-300 disabled:text-slate-500 flex items-center gap-1.5 transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${resending ? 'animate-spin' : ''}`} />
                {cooldownSeconds > 0 ? (
                  <span>Resend Code ({cooldownSeconds}s)</span>
                ) : (
                  <span>Resend Code</span>
                )}
              </button>
            </div>

            {/* Return to previous step link */}
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => {
                  setStep('initial');
                  setErrorMessage('');
                  setSuccessMessage('');
                }}
                className="text-xs font-medium text-slate-400 hover:text-white flex items-center justify-center gap-1.5 mx-auto transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Return to previous step</span>
              </button>
            </div>
          </form>

        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          STEP 3: SUCCESS STATE
      ───────────────────────────────────────────────────────────── */}
      {step === 'success' && (
        <div className="p-10 text-center space-y-4 animate-fadeIn">
          <div className="w-16 h-16 rounded-3xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto shadow-xl shadow-emerald-500/10">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-black text-white">
            Identity Verified
          </h3>
          <p className="text-xs text-slate-400">
            Authenticated session established. Connecting to FlashSeat engine...
          </p>
        </div>
      )}

    </div>
  );
}
