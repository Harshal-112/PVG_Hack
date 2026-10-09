import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import DashboardView from './views/DashboardView';
import MoviesView from './views/MoviesView';
import ShowtimesView from './views/ShowtimesView';
import BookingView from './views/BookingView';
import LoginView from './views/LoginView';
import TicketPassModal from './components/TicketPassModal';
import { getSharedBookings, fetchSharedBookings, cancelSharedBooking, subscribeToInventoryUpdates } from './services/inventorySync';
import { supabase } from './services/supabaseClient';
import { MOVIES, CINEMAS, INITIAL_BOOKINGS } from './data/mockData';
import { Zap, Heart, Shield, Film, X, Sun, Moon } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMovie, setSelectedMovie] = useState(MOVIES[0]);
  const [bookingState, setBookingState] = useState({
    movie: MOVIES[0],
    cinema: CINEMAS[0],
    showtime: CINEMAS[0].showtimes[2], // 05:15 PM
    date: 'Today, 25 Oct 2026'
  });

  // Load shared bookings from localStorage with INITIAL_BOOKINGS fallback
  const [bookingsList, setBookingsList] = useState(() => {
    try {
      const saved = localStorage.getItem('flashseat_bookings');
      if (saved) return JSON.parse(saved);
    } catch {
      // fallback
    }
    return INITIAL_BOOKINGS;
  });

  // Real-time synchronization across devices and tabs via Supabase & BroadcastChannel
  useEffect(() => {
    // Initial fetch from authoritative Supabase database
    fetchSharedBookings().then((remoteBookings) => {
      if (remoteBookings && Array.isArray(remoteBookings) && remoteBookings.length > 0) {
        setBookingsList(remoteBookings);
      }
    });

    const unsubscribe = subscribeToInventoryUpdates(async () => {
      const fresh = await fetchSharedBookings();
      if (fresh && Array.isArray(fresh) && fresh.length > 0) {
        setBookingsList(fresh);
      }
    });
    return unsubscribe;
  }, []);

  // Sync state changes to storage
  useEffect(() => {
    try {
      localStorage.setItem('flashseat_bookings', JSON.stringify(bookingsList));
    } catch {}
  }, [bookingsList]);

  const [viewingPass, setViewingPass] = useState(null);

  // Theme state: dark / light
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('flashseat_theme') || 'light';
  });

  // User Authentication state: defaults to null so user must log in first
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const sessionUser = sessionStorage.getItem('flashseat_user');
      if (sessionUser) return JSON.parse(sessionUser);

      const saved = localStorage.getItem('flashseat_user');
      if (saved) return JSON.parse(saved);
    } catch {}
    
    return null; // Require login first!
  });

  const [showLoginModal, setShowLoginModal] = useState(false);

  // Sync theme changes with DOM & LocalStorage
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('flashseat_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Listen for Supabase OAuth redirect or session restoration
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user && !currentUser) {
        const u = session.user;
        const verifiedUser = {
          id: u.id,
          name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'Member',
          email: u.email,
          initials: (u.user_metadata?.full_name || u.email || 'FS').substring(0, 2).toUpperCase(),
          provider: u.app_metadata?.provider || 'google',
          sessionToken: session.access_token,
          isVerified: true,
          verifiedAt: new Date().toISOString(),
        };
        setCurrentUser(verifiedUser);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const u = session.user;
        const verifiedUser = {
          id: u.id,
          name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'Member',
          email: u.email,
          initials: (u.user_metadata?.full_name || u.email || 'FS').substring(0, 2).toUpperCase(),
          provider: u.app_metadata?.provider || 'google',
          sessionToken: session.access_token,
          isVerified: true,
          verifiedAt: new Date().toISOString(),
        };
        setCurrentUser(verifiedUser);
        try {
          sessionStorage.setItem('flashseat_user', JSON.stringify(verifiedUser));
          localStorage.setItem('flashseat_user', JSON.stringify(verifiedUser));
        } catch {}
      }
    });

    return () => subscription?.unsubscribe();
  }, []);

  const handleLoginSuccess = (user) => {
    setCurrentUser(user);
    try {
      sessionStorage.setItem('flashseat_user', JSON.stringify(user));
      localStorage.setItem('flashseat_user', JSON.stringify(user));
    } catch {}
    setShowLoginModal(false);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    try {
      supabase.auth.signOut();
      sessionStorage.removeItem('flashseat_user');
      localStorage.removeItem('flashseat_user');
    } catch {}
  };

  // Quick navigation helpers
  const handleSelectMovie = (movie) => {
    setSelectedMovie(movie);
    setActiveTab('showtimes');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBookNow = (movie) => {
    setSelectedMovie(movie);
    setBookingState((prev) => ({
      ...prev,
      movie
    }));
    setActiveTab('showtimes');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleProceedToBooking = ({ movie, cinema, showtime, date }) => {
    setBookingState({
      movie,
      cinema,
      showtime,
      date
    });
    setActiveTab('booking');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAddBooking = (newBooking) => {
    setBookingsList((prev) => {
      const updated = [newBooking, ...prev.filter(b => b.bookingId !== newBooking.bookingId)];
      try {
        localStorage.setItem('flashseat_bookings', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const handleCancelBooking = async (bookingId) => {
    await cancelSharedBooking(bookingId);
    setBookingsList((prev) => {
      const updated = prev.filter((b) => b.bookingId !== bookingId);
      try {
        localStorage.setItem('flashseat_bookings', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const upcomingBooking = bookingsList.find((b) => b.isUpcoming);

  // GATEWAY CHECK: First the user must login then only other things can be accessed
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#f8fafc] dark:bg-slate-950 text-slate-800 dark:text-slate-100 flex flex-col font-['Plus_Jakarta_Sans',sans-serif] transition-colors duration-200">
        {/* Gateway Header with Brand & Theme Toggle */}
        <header className="sticky top-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 transition-colors">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/25">
                <Zap className="w-5 h-5 fill-white text-white" />
              </div>
              <div>
                <span className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                  Flash<span className="text-indigo-600 dark:text-indigo-400">Seat</span>
                </span>
                <span className="hidden sm:block text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 -mt-1">
                  Cinema Booking
                </span>
              </div>
            </div>

            {/* Dark & Light theme button at topbar right corner */}
            <button
              onClick={toggleTheme}
              className="p-2 sm:px-2.5 sm:py-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-amber-400 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200/80 dark:border-slate-700 transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400 fill-amber-400" />
                  <span className="hidden sm:inline text-[11px] font-bold text-slate-200">Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-indigo-600 fill-indigo-600" />
                  <span className="hidden sm:inline text-[11px] font-bold text-slate-700">Dark</span>
                </>
              )}
            </button>
          </div>
        </header>

        {/* Gateway Main Content */}
        <main className="flex-1 flex items-center justify-center p-4 sm:p-6 my-auto">
          <div className="w-full max-w-md">
            <div className="mb-4 text-center">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-bold uppercase tracking-wider">
                <Shield className="w-3.5 h-3.5" />
                <span>Account Required</span>
              </span>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                Please log in to your account or register to unlock cinema schedules, real-time seat locks, and booking passes.
              </p>
            </div>
            <LoginView onLoginSuccess={handleLoginSuccess} />
          </div>
        </main>

        {/* Gateway Footer */}
        <footer className="py-6 border-t border-slate-200/80 dark:border-slate-800 text-center text-xs text-slate-400 dark:text-slate-500">
          FlashSeat Cinema Authentication Gateway • Sign in to access your seats and reservations
        </footer>
      </div>
    );
  }

  // Once authenticated, render full application
  return (
    <div className="min-h-screen bg-[#f8fafc] dark:bg-slate-950 text-slate-800 dark:text-slate-100 flex flex-col font-['Plus_Jakarta_Sans',sans-serif] transition-colors duration-200">
      
      {/* 1. Global Navbar with Theme Switcher & Auth */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        searchQuery={searchQuery}
        setSearchQuery={(q) => {
          setSearchQuery(q);
          if (q.trim() && activeTab !== 'movies') {
            setActiveTab('movies');
          }
        }}
        theme={theme}
        toggleTheme={toggleTheme}
        currentUser={currentUser}
        onLogout={handleLogout}
        onOpenLogin={() => setShowLoginModal(true)}
      />

      {/* 2. Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {activeTab === 'dashboard' && (
          <DashboardView
            onSelectMovie={handleSelectMovie}
            onBookNow={handleBookNow}
            onNavigateToMovies={() => {
              setActiveTab('movies');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onNavigateToShowtimes={(movie) => {
              setSelectedMovie(movie || MOVIES[0]);
              setActiveTab('showtimes');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            upcomingBooking={upcomingBooking}
            onViewBookingPass={(b) => setViewingPass(b)}
          />
        )}

        {activeTab === 'movies' && (
          <MoviesView
            onSelectMovie={handleSelectMovie}
            onBookNow={handleBookNow}
            globalSearchQuery={searchQuery}
            setGlobalSearchQuery={setSearchQuery}
          />
        )}

        {activeTab === 'showtimes' && (
          <ShowtimesView
            selectedMovie={selectedMovie}
            onChangeMovie={(m) => setSelectedMovie(m)}
            onProceedToBooking={handleProceedToBooking}
          />
        )}

        {activeTab === 'booking' && (
          <BookingView
            bookingState={bookingState}
            onBackToShowtimes={() => {
              setActiveTab('showtimes');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            bookingsList={bookingsList}
            onAddBooking={handleAddBooking}
            onCancelBooking={handleCancelBooking}
            currentUser={currentUser}
            onOpenLogin={() => setShowLoginModal(true)}
          />
        )}
      </main>

      {/* 3. Global Footer */}
      <footer className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 mt-auto py-8 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-sm">
              <Zap className="w-3.5 h-3.5 fill-white" />
            </div>
            <span className="font-extrabold text-slate-800 dark:text-white text-sm">
              Flash<span className="text-indigo-600 dark:text-indigo-400">Seat</span>
            </span>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <span>Zero Double-Booking Real-Time Seat Allocation Engine</span>
          </div>

          <div className="flex items-center gap-6 text-slate-500 dark:text-slate-400">
            <button onClick={() => setActiveTab('dashboard')} className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer">
              Dashboard
            </button>
            <button onClick={() => setActiveTab('movies')} className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer">
              Movies
            </button>
            <button onClick={() => setActiveTab('showtimes')} className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer">
              Showtimes
            </button>
            <button onClick={() => setActiveTab('booking')} className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer">
              Booking Wallet
            </button>
          </div>

          <div className="text-slate-400 dark:text-slate-500 text-[11px]">
            Atomic Mutex Locks Active • Real-time Cross-tab Sync
          </div>
        </div>
      </footer>

      {/* Global Ticket Pass Modal */}
      {viewingPass && (
        <TicketPassModal
          booking={viewingPass}
          onClose={() => setViewingPass(null)}
          onViewBookings={() => {
            setViewingPass(null);
            setActiveTab('booking');
          }}
        />
      )}

      {/* Login & Registration Modal */}
      {showLoginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-md animate-fadeIn">
          <div className="relative w-full max-w-md">
            <button
              onClick={() => setShowLoginModal(false)}
              className="absolute top-4 right-4 z-10 p-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
            <LoginView
              onLoginSuccess={handleLoginSuccess}
              onCancel={() => setShowLoginModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
