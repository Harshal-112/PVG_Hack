import React, { useState, useEffect, useRef } from 'react';
import { 
  Zap, 
  Lock, 
  Mail, 
  User, 
  ArrowRight, 
  ShieldCheck, 
  Shield,
  Sparkles,
  CheckCircle2,
  Eye,
  EyeOff,
  Smartphone,
  KeyRound,
  ArrowLeft,
  RefreshCw,
  Check
} from 'lucide-react';

export default function LoginView({ onLoginSuccess, onCancel }) {
  // Step state: 'auth' (Step 1) | 'google_input' | 'mfa' (Step 2) | 'success'
  const [step, setStep] = useState('auth');
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Form states (Step 1)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  // Google sign-in states (User Input)
  const [googleEmail, setGoogleEmail] = useState('');
  const [googleName, setGoogleName] = useState('');
  const [googleError, setGoogleError] = useState('');

  // Authenticated user pending MFA
  const [pendingUser, setPendingUser] = useState(null);

  // MFA states (Step 2)
  const [mfaType, setMfaType] = useState('authenticator'); // 'authenticator' | 'sms'
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [demoCode, setDemoCode] = useState('482910');
  const [timerSeconds, setTimerSeconds] = useState(119);
  const [trustDevice, setTrustDevice] = useState(true);
  const [mfaError, setMfaError] = useState('');

  const inputRefs = useRef([]);

  // Countdown timer for 2FA code expiry
  useEffect(() => {
    if (step !== 'mfa' || timerSeconds <= 0) return;
    const interval = setInterval(() => {
      setTimerSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [step, timerSeconds]);

  // Format seconds into MM:SS
  const formatTimer = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Google SVG Logo Icon
  const GoogleIcon = () => (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
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

  // STEP 1: Continue with Google
  const handleGoogleSignIn = () => {
    setLoading(true);
    setErrorMessage('');
    setGoogleError('');
    setGoogleEmail('');
    setGoogleName('');
    setTimeout(() => {
      setLoading(false);
      setStep('google_input');
    }, 300);
  };

  const handleGoogleInputSubmit = (e) => {
    e.preventDefault();
    setGoogleError('');

    const trimmedEmail = googleEmail.trim();
    if (!trimmedEmail) {
      setGoogleError('Please enter your Google email address or phone number.');
      return;
    }

    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      const cleanEmail = trimmedEmail.includes('@') ? trimmedEmail : `${trimmedEmail}@gmail.com`;
      const cleanName = googleName.trim() || cleanEmail.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
      const initials = cleanName.split(' ').map((w) => w[0]).join('').substring(0, 2).toUpperCase() || 'G';

      setPendingUser({
        name: cleanName,
        email: cleanEmail,
        initials: initials,
        provider: 'google',
        isVip: true,
        tier: 'Google Verified Member',
        memberSince: '2026',
        mfaEnabled: true,
      });

      // Generate a new 6-digit verification code for this session
      const newCode = String(Math.floor(100000 + Math.random() * 900000));
      setDemoCode(newCode);
      setTimerSeconds(119);
      setOtp(['', '', '', '', '', '']);
      setStep('mfa');
    }, 400);
  };

  // STEP 1: Email + Password Submit
  const handleCredentialsSubmit = (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (!email || !password) {
      setErrorMessage('Please fill in both email and password.');
      return;
    }

    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      const user = {
        name: name || email.split('@')[0] || 'FlashSeat Member',
        email: email,
        initials: (name || email).substring(0, 2).toUpperCase(),
        provider: 'email',
        isVip: true,
        tier: 'VIP Platinum',
        memberSince: '2026',
        mfaEnabled: true,
      };
      setPendingUser(user);
      const newCode = String(Math.floor(100000 + Math.random() * 900000));
      setDemoCode(newCode);
      setTimerSeconds(119);
      setOtp(['', '', '', '', '', '']);
      setStep('mfa');
    }, 500);
  };

  // Quick 1-Click Demo Login
  const handleQuickLogin = (role) => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      const user = role === 'vip' ? {
        name: 'Alex Vance',
        email: 'alex.vance@flashseat.demo',
        initials: 'AV',
        provider: 'demo',
        isVip: true,
        tier: 'VIP Platinum',
        memberSince: '2026',
        mfaEnabled: true,
      } : {
        name: 'Guest Explorer',
        email: 'guest@flashseat.demo',
        initials: 'GE',
        provider: 'demo',
        isVip: false,
        tier: 'Standard',
        memberSince: '2026',
        mfaEnabled: true,
      };
      setPendingUser(user);
      setDemoCode('482910');
      setTimerSeconds(119);
      setOtp(['', '', '', '', '', '']);
      setStep('mfa');
    }, 350);
  };

  // Handle OTP Digit Input
  const handleOtpChange = (index, value) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);
    setMfaError('');

    // Auto-advance to next input
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
    const pasteData = e.clipboardData.getData('text').trim();
    if (/^\d{6}$/.test(pasteData)) {
      const digits = pasteData.split('');
      setOtp(digits);
      setMfaError('');
      if (inputRefs.current[5]) inputRefs.current[5].focus();
    }
  };

  const handleAutoFillCode = () => {
    setOtp(demoCode.split(''));
    setMfaError('');
    if (inputRefs.current[5]) inputRefs.current[5].focus();
  };

  // STEP 2: Verify MFA 6-digit Code
  const handleVerifyMfa = (e) => {
    e?.preventDefault();
    const enteredCode = otp.join('');

    if (enteredCode.length !== 6) {
      setMfaError('Please enter all 6 verification digits.');
      return;
    }

    // Accept session demoCode or any valid 6-digit verification code for seamless testing
    setLoading(true);
    setMfaError('');

    setTimeout(() => {
      setLoading(false);
      setStep('success');

      setTimeout(() => {
        const verifiedUser = {
          ...pendingUser,
          mfaVerified: true,
          twoFactorAuthTime: new Date().toISOString(),
        };
        onLoginSuccess(verifiedUser);
      }, 700);
    }, 600);
  };

  return (
    <div className="w-full max-w-md mx-auto bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden transition-all animate-fadeIn">
      
      {/* ─────────────────────────────────────────────────────────────
          STATE 1: Google Account Sign-In (User Input)
      ───────────────────────────────────────────────────────────── */}
      {step === 'google_input' && (
        <div className="p-8 space-y-6 animate-fadeIn">
          {/* Google Header */}
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center mx-auto shadow-sm">
              <GoogleIcon />
            </div>
            <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
              Sign in with Google
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              to continue to <span className="font-bold text-slate-700 dark:text-slate-300">FlashSeat Cinema</span>
            </p>
          </div>

          {googleError && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-semibold animate-fadeIn">
              {googleError}
            </div>
          )}

          {/* Google Account Form */}
          <form onSubmit={handleGoogleInputSubmit} className="space-y-4">
            <div>
              <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block mb-1">
                Google Email or Phone
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="e.g. yourname@gmail.com"
                  value={googleEmail}
                  onChange={(e) => setGoogleEmail(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                  required
                />
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block mb-1">
                Your Name <span className="text-slate-400 font-normal lowercase">(optional)</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="e.g. Alex Vance"
                  value={googleName}
                  onChange={(e) => setGoogleName(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Google will securely verify your account identity via <span className="font-bold text-slate-700 dark:text-slate-200">2-Step Verification</span> before granting access.
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep('auth')}
                className="text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>

              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2.5 rounded-xl bg-[#1a73e8] hover:bg-[#1557b0] text-white text-xs font-bold shadow-md shadow-blue-500/20 transition-all flex items-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Connecting...</span>
                  </>
                ) : (
                  <>
                    <span>Next</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          STATE 2: Multi-Factor Authentication (2-Step Verification)
      ───────────────────────────────────────────────────────────── */}
      {step === 'mfa' && (
        <div className="p-8 space-y-6">
          
          {/* Header with 2-Step Verification Shield */}
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mx-auto shadow-md shadow-indigo-600/10 relative">
              <ShieldCheck className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 text-white text-[9px] font-black flex items-center justify-center">
                2
              </span>
            </div>

            <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold uppercase tracking-wider">
              <span>Step 2 of 2</span> • <span>Two-Factor Authentication</span>
            </div>

            <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              2-Step Verification
            </h3>
            
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
              To protect your seats and tickets, please enter the 6-digit security code.
            </p>
          </div>

          {/* Account Identifier Badge */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              {pendingUser?.provider === 'google' ? (
                <div className="w-6 h-6 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center flex-shrink-0">
                  <GoogleIcon />
                </div>
              ) : (
                <div className="w-6 h-6 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center flex-shrink-0">
                  <Mail className="w-3.5 h-3.5" />
                </div>
              )}
              <div className="min-w-0">
                <div className="font-bold text-slate-800 dark:text-slate-200 truncate">
                  {pendingUser?.name}
                </div>
                <div className="text-[10px] text-slate-400 truncate">
                  {pendingUser?.email}
                </div>
              </div>
            </div>
            <button
              onClick={() => setStep('auth')}
              className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex-shrink-0"
            >
              Change
            </button>
          </div>

          {/* MFA Method Switcher Pills */}
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl">
            <button
              type="button"
              onClick={() => { setMfaType('authenticator'); setMfaError(''); }}
              className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                mfaType === 'authenticator'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Google Authenticator</span>
            </button>
            <button
              type="button"
              onClick={() => { setMfaType('sms'); setMfaError(''); }}
              className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                mfaType === 'sms'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>SMS / Mobile OTP</span>
            </button>
          </div>

          {/* 6-Digit OTP Box Form */}
          <form onSubmit={handleVerifyMfa} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {mfaType === 'authenticator' ? 'Enter 6-Digit Authenticator Code' : 'Enter 6-Digit SMS Code'}
                </label>
                <span className="text-[11px] font-mono font-semibold text-slate-400">
                  Expires in: <span className="text-indigo-600 dark:text-indigo-400 font-bold">{formatTimer(timerSeconds)}</span>
                </span>
              </div>

              {/* 6 Individual Digit Inputs */}
              <div className="grid grid-cols-6 gap-2" onPaste={handleOtpPaste}>
                {otp.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => (inputRefs.current[idx] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    className="w-full h-12 text-center text-lg font-mono font-black rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-inner"
                    autoFocus={idx === 0}
                  />
                ))}
              </div>
            </div>

            {mfaError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-semibold animate-fadeIn">
                {mfaError}
              </div>
            )}

            {/* Quick Demo Helper for Hackathon / Testing Ease */}
            <div className="p-3 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-900/60 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
                <span className="text-indigo-950 dark:text-indigo-200">
                  Security Code: <span className="font-mono font-black text-indigo-600 dark:text-indigo-400 tracking-wider">{demoCode}</span>
                </span>
              </div>
              <button
                type="button"
                onClick={handleAutoFillCode}
                className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] shadow-sm transition-colors cursor-pointer flex-shrink-0"
              >
                Auto-fill Code
              </button>
            </div>

            {/* Trust this device checkbox */}
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={trustDevice}
                onChange={(e) => setTrustDevice(e.target.checked)}
                className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
              />
              <span>Don't ask for 2-step verification on this device for 30 days</span>
            </label>

            {/* Submit Verification Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-600/30 hover:shadow-indigo-600/50 hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Verifying Credentials...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Verify & Complete Sign In</span>
                </>
              )}
            </button>
          </form>

          {/* Resend & Back Buttons */}
          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                const newCode = String(Math.floor(100000 + Math.random() * 900000));
                setDemoCode(newCode);
                setTimerSeconds(119);
                setOtp(['', '', '', '', '', '']);
                alert(`New 2FA code generated: ${newCode}`);
              }}
              className="text-indigo-600 dark:text-indigo-400 hover:underline font-bold flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Resend Code</span>
            </button>

            <button
              type="button"
              onClick={() => setStep('auth')}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-semibold"
            >
              Use another account
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          STATE 3: Success Screen (Momentary Transition)
      ───────────────────────────────────────────────────────────── */}
      {step === 'success' && (
        <div className="p-10 text-center space-y-4 animate-fadeIn">
          <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-xl font-black text-slate-900 dark:text-white">
              2-Step Verification Succeeded!
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Identity verified securely. Unlocking FlashSeat cinema seats...
            </p>
          </div>
          <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto pt-2" />
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          STATE 0: Initial Login & Register Form (Step 1)
      ───────────────────────────────────────────────────────────── */}
      {step === 'auth' && (
        <div>
          {/* Header with FlashSeat Logo */}
          <div className="p-8 text-center bg-gradient-to-b from-indigo-50/70 dark:from-indigo-950/30 to-transparent border-b border-slate-100 dark:border-slate-800">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white mx-auto mb-3 shadow-lg shadow-indigo-600/30">
              <Zap className="w-6 h-6 fill-white" />
            </div>

            <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              Flash<span className="text-indigo-600">Seat</span> Account
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Sign in with Google or your credentials to access tickets and seat locks
            </p>

            {/* Mode Switch Tabs */}
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl mt-5">
              <button
                onClick={() => { setAuthMode('login'); setErrorMessage(''); }}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                  authMode === 'login'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => { setAuthMode('register'); setErrorMessage(''); }}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                  authMode === 'register'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Create Account
              </button>
            </div>
          </div>

          {/* Auth Form Body */}
          <div className="p-8 space-y-5">
            {errorMessage && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-semibold">
                {errorMessage}
              </div>
            )}

            {/* 1. PROMINENT "CONTINUE WITH GOOGLE" BUTTON */}
            <div>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="w-full py-3.5 px-4 rounded-2xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-700 dark:text-slate-100 font-bold text-xs shadow-sm hover:shadow transition-all flex items-center justify-center gap-3 cursor-pointer group"
              >
                <GoogleIcon />
                <span>Continue with Google</span>
                <span className="ml-auto text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                  2FA Active
                </span>
              </button>
            </div>

            {/* Divider */}
            <div className="relative flex items-center justify-center">
              <div className="border-t border-slate-200 dark:border-slate-800 w-full" />
              <span className="bg-white dark:bg-slate-900 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 flex-shrink-0">
                Or with Email & Password
              </span>
            </div>

            <form onSubmit={handleCredentialsSubmit} className="space-y-4">
              
              {/* Name Input on Register */}
              {authMode === 'register' && (
                <div>
                  <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block mb-1">
                    Full Name
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="e.g. Jordan Miller"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      required
                    />
                    <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  </div>
                </div>
              )}

              {/* Email Input */}
              <div>
                <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block mb-1">
                  Email Address or Username
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
              </div>

              {/* Password Input */}
              <div>
                <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block mb-1">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-9 pr-10 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Remember Me & Forgot Password */}
              {authMode === 'login' && (
                <div className="flex items-center justify-between text-xs pt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-slate-600 dark:text-slate-400">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                    />
                    <span>Remember me</span>
                  </label>

                  <button
                    type="button"
                    onClick={() => alert('Password reset verification link sent.')}
                    className="text-indigo-600 dark:text-indigo-400 hover:underline font-bold"
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              {/* Submit CTA */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-600/30 hover:shadow-indigo-600/50 hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 cursor-pointer mt-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <span>{authMode === 'login' ? 'Continue to 2-Step Verification' : 'Create & Verify Account'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {/* Quick Demo One-Click Access Buttons */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-center space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Or Instant One-Click Demo Access
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleQuickLogin('vip')}
                  className="p-2.5 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-900 text-indigo-700 dark:text-indigo-300 text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>VIP Member</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleQuickLogin('guest')}
                  className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer"
                >
                  Guest Explorer
                </button>
              </div>
            </div>

            {/* Cancel button if modal/overlay */}
            {onCancel && (
              <button
                onClick={onCancel}
                className="w-full text-center text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-semibold pt-1 cursor-pointer"
              >
                Back to Browsing
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
