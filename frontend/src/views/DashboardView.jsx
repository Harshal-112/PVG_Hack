import React, { useState } from 'react';
import HeroBanner from '../components/HeroBanner';
import MovieCard from '../components/MovieCard';
import { MOVIES, CINEMAS } from '../data/mockData';
import { 
  Sparkles, 
  ArrowRight, 
  Search, 
  MapPin, 
  Calendar, 
  Ticket, 
  ShieldCheck, 
  Zap,
  TrendingUp
} from 'lucide-react';

export default function DashboardView({ 
  onSelectMovie, 
  onBookNow, 
  onNavigateToMovies, 
  onNavigateToShowtimes,
  upcomingBooking,
  onViewBookingPass
}) {
  const [selectedGenre, setSelectedGenre] = useState('All');
  const [selectedCityCinema, setSelectedCityCinema] = useState(CINEMAS[0].id);
  const [trailerModal, setTrailerModal] = useState(false);

  const heroMovie = MOVIES[0]; // Beyond the Blue
  const filterPills = ['All', 'Sci-Fi', 'Action', 'Thriller', 'Adventure'];

  const filteredPopularMovies = MOVIES.filter((m) => {
    if (selectedGenre === 'All') return true;
    return m.genre.includes(selectedGenre);
  });

  return (
    <div className="space-y-8 sm:space-y-12 animate-fadeIn pb-16">
      
      {/* 1. Header Banner & Subtitle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2">
        <div>
          <span className="text-[11px] font-extrabold tracking-widest text-indigo-600 dark:text-indigo-400 uppercase">
            ⚡ FlashSeat Cinema Ecosystem
          </span>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            The premier digital night out platform.
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Live entertainment, sub-second seat locking, and verified e-tickets.
          </p>
        </div>

        {/* Status Chip */}
        <div className="flex items-center gap-2 self-start sm:self-auto bg-white dark:bg-slate-900 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-800 shadow-sm text-xs font-semibold text-slate-700 dark:text-slate-300">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Real-time Seating Live</span>
        </div>
      </div>

      {/* 2. Hero Premiere Card (Frame 2 matching) */}
      <HeroBanner
        movie={heroMovie}
        onBookNow={() => onBookNow(heroMovie)}
        onWatchTrailer={() => setTrailerModal(true)}
      />

      {/* 3. Quick Booking Search Strip */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shadow-sm transition-colors">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 items-center">
          
          {/* Cinema Location */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-700/60">
            <MapPin className="w-4 h-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500 block">Theatre Location</span>
              <select
                value={selectedCityCinema}
                onChange={(e) => setSelectedCityCinema(e.target.value)}
                className="w-full bg-transparent text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer truncate"
              >
                {CINEMAS.map(c => (
                  <option key={c.id} value={c.id} className="dark:bg-slate-900 dark:text-white">{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Date Picker */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-700/60">
            <Calendar className="w-4 h-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500 block">Show Date</span>
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Today, 25 Oct 2026
              </div>
            </div>
          </div>

          {/* Movie Category */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-700/60">
            <Ticket className="w-4 h-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500 block">Experience</span>
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                IMAX 2D • Dolby Atmos
              </div>
            </div>
          </div>

          {/* Search CTA */}
          <button
            onClick={() => onNavigateToShowtimes(heroMovie)}
            className="w-full py-3.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md shadow-indigo-600/20 hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Search className="w-4 h-4" />
            <span>Find Showtimes</span>
          </button>
        </div>
      </div>

      {/* 4. Popular Movies Section */}
      <section className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <h3 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                Popular Movies
              </h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Top trending releases booked this week
            </p>
          </div>

          {/* Filter Pills & View All */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
              {filterPills.map((genre) => (
                <button
                  key={genre}
                  onClick={() => setSelectedGenre(genre)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    selectedGenre === genre
                      ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {genre}
                </button>
              ))}
            </div>

            <button
              onClick={onNavigateToMovies}
              className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline pl-2 cursor-pointer"
            >
              <span>View All</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 4 Column Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {filteredPopularMovies.slice(0, 4).map((movie) => (
            <MovieCard
              key={movie.id}
              movie={movie}
              onSelectMovie={onSelectMovie}
              onBookNow={onBookNow}
            />
          ))}
        </div>
      </section>

      {/* 5. Bottom Section: Upcoming Booking reminder & Perks Promo */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 pt-2">
        
        {/* Active / Upcoming Ticket Reminder */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm flex flex-col justify-between transition-colors">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Active Booking
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                Ready for entry
              </span>
            </div>

            {upcomingBooking ? (
              <div className="space-y-3">
                <div className="flex gap-3 items-center">
                  <img
                    src={upcomingBooking.movie?.poster}
                    alt={upcomingBooking.movie?.title}
                    className="w-12 h-16 object-cover rounded-xl bg-slate-900 shadow-sm flex-shrink-0"
                  />
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                      {upcomingBooking.movie?.title}
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {upcomingBooking.cinema}
                    </p>
                    <div className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                      {upcomingBooking.time} • Seats {upcomingBooking.seats.join(', ')}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => onViewBookingPass(upcomingBooking)}
                  className="w-full mt-2 py-2.5 px-4 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-bold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Ticket className="w-3.5 h-3.5" />
                  <span>View Scannable Pass</span>
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-400 dark:text-slate-500 py-4 text-center">
                No active bookings right now. Reserve a movie seat above!
              </p>
            )}
          </div>
        </div>

        {/* Promo Perks Card */}
        <div className="lg:col-span-2 bg-gradient-to-r from-indigo-900 via-indigo-950 to-slate-900 rounded-3xl p-6 sm:p-8 text-white relative overflow-hidden shadow-md border border-indigo-900/80 flex flex-col justify-between">
          <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-20 pointer-events-none bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-400 to-transparent" />
          
          <div className="relative z-10">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 text-indigo-200 text-[11px] font-bold uppercase tracking-wider mb-3">
              <Zap className="w-3.5 h-3.5 fill-indigo-300 text-indigo-300" />
              <span>FlashPass Privilege</span>
            </div>
            <h3 className="text-xl sm:text-2xl font-black text-white mb-2">
              Save 20% on all weekday screenings with code <span className="text-indigo-400">FLASHPASS</span>
            </h3>
            <p className="text-xs sm:text-sm text-slate-300 max-w-lg mb-6">
              Enjoy zero convenience fees, priority queue admission in high-demand releases, and exclusive IMAX recliner upgrades.
            </p>
          </div>

          <div className="relative z-10 flex items-center gap-3">
            <button
              onClick={onNavigateToMovies}
              className="px-5 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-xs transition-colors shadow-sm cursor-pointer"
            >
              Browse Screenings
            </button>
            <span className="text-xs text-slate-400">
              Valid until 31 Dec 2026
            </span>
          </div>
        </div>
      </div>

      {/* Trailer Modal Simulation */}
      {trailerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 rounded-3xl overflow-hidden max-w-2xl w-full border border-slate-700 shadow-2xl p-6 text-white text-center">
            <h3 className="text-lg font-bold mb-2">{heroMovie.title} — Official Teaser</h3>
            <p className="text-xs text-slate-400 mb-6">Simulated Dolby Atmos 4K Cinema Teaser</p>
            <div className="aspect-video bg-black rounded-2xl flex items-center justify-center relative overflow-hidden mb-6 border border-slate-800">
              <img
                src={heroMovie.banner || heroMovie.poster}
                alt={heroMovie.title}
                className="w-full h-full object-cover opacity-60"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-indigo-600/90 text-white flex items-center justify-center shadow-lg shadow-indigo-600/50">
                  ▶
                </div>
              </div>
            </div>
            <button
              onClick={() => setTrailerModal(false)}
              className="px-6 py-2.5 rounded-xl bg-white/20 hover:bg-white/30 text-white font-bold text-xs transition-colors cursor-pointer"
            >
              Close Trailer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
