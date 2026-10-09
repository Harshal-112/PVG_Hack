import React, { useState, useMemo, useEffect } from 'react';
import DateSlider from '../components/DateSlider';
import ShowtimeCard from '../components/ShowtimeCard';
import { CINEMAS, MOVIES } from '../data/mockData';
import { 
  Calendar, 
  MapPin, 
  Clock, 
  Film, 
  ArrowRight, 
  Star, 
  ShieldCheck,
  ChevronDown,
  Sparkles
} from 'lucide-react';

export default function ShowtimesView({ 
  selectedMovie = MOVIES[0], 
  onChangeMovie, 
  onProceedToBooking 
}) {
  const [selectedDate, setSelectedDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [selectedFormat, setSelectedFormat] = useState('All Formats');
  const [activeShowtime, setActiveShowtime] = useState({
    id: 'st1',
    time: '10:00 AM',
    format: '2D',
    cinemaId: 'apex_grand',
    cinemaName: 'Apex Grand Cinemas • Screen 2'
  });

  const formats = ['All Formats', '2D', '3D', 'IMAX 2D', '4DX', 'Dolby Atmos'];

  // Filter cinemas and their showtimes based on selectedFormat
  const filteredCinemas = useMemo(() => {
    return CINEMAS.map((cinema) => {
      const matchingShowtimes = cinema.showtimes.filter((slot) => {
        if (selectedFormat === 'All Formats') return true;
        return slot.format.toLowerCase().trim() === selectedFormat.toLowerCase().trim();
      });

      return {
        ...cinema,
        showtimes: matchingShowtimes,
      };
    }).filter((cinema) => cinema.showtimes.length > 0);
  }, [selectedFormat]);

  // Synchronize activeShowtime when selectedFormat changes to ensure matching selection
  useEffect(() => {
    if (filteredCinemas.length > 0) {
      const allSlots = filteredCinemas.flatMap((c) =>
        c.showtimes.map((slot) => ({ ...slot, cinemaId: c.id, cinemaName: c.name }))
      );
      const isCurrentValid = allSlots.some(
        (s) => s.id === activeShowtime?.id && s.cinemaId === activeShowtime?.cinemaId
      );
      if (!isCurrentValid && allSlots.length > 0) {
        setActiveShowtime(allSlots[0]);
      }
    }
  }, [selectedFormat, filteredCinemas, activeShowtime?.id, activeShowtime?.cinemaId]);

  // Movies available for now-showing
  const availableMovies = useMemo(() => {
    const nowShowing = MOVIES.filter((m) => m.releaseType === 'now_showing');
    if (selectedFormat === 'All Formats') return nowShowing;
    const formatFiltered = nowShowing.filter((m) =>
      m.formats?.some((f) => f.toLowerCase().trim() === selectedFormat.toLowerCase().trim())
    );
    return formatFiltered.length > 0 ? formatFiltered : nowShowing;
  }, [selectedFormat]);

  return (
    <div className="space-y-8 animate-fadeIn pb-16">
      
      {/* 1. Selected Movie Header Card matching Frame 5 */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 sm:p-8 shadow-sm transition-colors">
        <div className="flex flex-col md:flex-row items-start justify-between gap-6">
          <div className="flex flex-col sm:flex-row gap-5 items-start">
            
            {/* Movie Poster Thumbnail */}
            <div className="w-24 h-36 sm:w-28 sm:h-40 rounded-2xl overflow-hidden bg-slate-900 shadow-md flex-shrink-0 relative group">
              <img
                src={selectedMovie?.poster}
                alt={selectedMovie?.title}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.target.src = '/posters/beyond_the_blue.png';
                }}
              />
              <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-bold bg-black/60 text-white backdrop-blur-md">
                {selectedMovie?.cert}
              </div>
            </div>

            {/* Movie Metadata */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Now Booking
                </span>
                <div className="flex items-center gap-1 text-xs font-bold text-amber-500">
                  <Star className="w-3.5 h-3.5 fill-amber-400" />
                  <span>{selectedMovie?.rating}</span>
                </div>
              </div>

              <h2 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                {selectedMovie?.title}
              </h2>

              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                <span className="font-semibold text-slate-700 dark:text-slate-300">{selectedMovie?.genre?.join(' • ')}</span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {selectedMovie?.duration}
                </span>
                <span>•</span>
                <span>{selectedMovie?.language}</span>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-400 max-w-xl line-clamp-2 leading-relaxed">
                {selectedMovie?.description}
              </p>
            </div>
          </div>

          {/* Quick Movie Switcher */}
          <div className="self-end sm:self-start w-full sm:w-auto">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1">
              Change Screening
            </span>
            <select
              value={selectedMovie?.id}
              onChange={(e) => {
                const found = MOVIES.find((m) => m.id === e.target.value);
                if (found) onChangeMovie(found);
              }}
              className="w-full sm:w-56 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              {availableMovies.map((m) => (
                <option key={m.id} value={m.id} className="dark:bg-slate-900 dark:text-white">
                  {m.title}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 2. Date Selection Carousel */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <Calendar className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>Select Date</span>
          </div>
          <span className="text-xs text-slate-400 dark:text-slate-500">Shows for next 7 days</span>
        </div>
        <DateSlider 
          selectedDate={selectedDate} 
          onSelectDate={setSelectedDate} 
        />
      </div>

      {/* 3. Main Split View: Cinemas List on left, Sticky Showtime Summary on right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        
        {/* Cinema Showtimes Listing */}
        <div className="lg:col-span-2 space-y-5">
          
          {/* Format & Period Filter Strip */}
          <div className="flex items-center justify-between gap-3 overflow-x-auto pb-2 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {formats.map((fmt) => {
                const isSelected = selectedFormat === fmt;
                return (
                  <button
                    key={fmt}
                    onClick={() => setSelectedFormat(fmt)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm ring-2 ring-indigo-500/30'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-indigo-600 dark:hover:text-indigo-400'
                    }`}
                  >
                    {fmt}
                  </button>
                );
              })}
            </div>

            <span className="text-xs text-slate-400 dark:text-slate-500 hidden sm:inline flex-shrink-0 font-medium">
              {filteredCinemas.length} {filteredCinemas.length === 1 ? 'Cinema' : 'Cinemas'} Available {selectedFormat !== 'All Formats' ? `• ${selectedFormat}` : ''}
            </span>
          </div>

          {/* Cinema Cards List */}
          <div className="space-y-4">
            {filteredCinemas.length > 0 ? (
              filteredCinemas.map((cinema) => (
                <ShowtimeCard
                  key={cinema.id}
                  cinema={cinema}
                  selectedShowtime={activeShowtime}
                  onSelectShowtime={(slot) => setActiveShowtime(slot)}
                />
              ))
            ) : (
              <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-10 text-center space-y-3">
                <Film className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto" />
                <h4 className="text-base font-bold text-slate-800 dark:text-slate-200">
                  No {selectedFormat} Screenings Available
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                  There are currently no {selectedFormat} showtimes scheduled for {selectedMovie?.title}. Switch to "All Formats" to see other formats.
                </p>
                <button
                  onClick={() => setSelectedFormat('All Formats')}
                  className="mt-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors cursor-pointer shadow-sm"
                >
                  View All Formats
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Sticky Sidebar: Showtime Selection & Pricing */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm sticky top-24 space-y-5 transition-colors">
          <div className="pb-4 border-b border-slate-100 dark:border-slate-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
              Screening Selected
            </span>
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white mt-1">
              {selectedMovie?.title}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {activeShowtime?.cinemaName}
            </p>
          </div>

          {/* Date & Time pill */}
          <div className="bg-slate-50 dark:bg-slate-800/70 rounded-2xl p-4 border border-slate-100 dark:border-slate-700/60 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 dark:text-slate-500 font-medium">Date</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">
                {selectedDate}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 dark:text-slate-500 font-medium">Showtime</span>
              <span className="font-bold text-indigo-600 dark:text-indigo-400">
                {activeShowtime?.time} ({activeShowtime?.format})
              </span>
            </div>
          </div>

          {/* Ticket Price Tiers Reference */}
          <div>
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-2.5">
              Seat Categories & Pricing
            </span>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-purple-50/70 dark:bg-purple-950/40 border border-purple-100 dark:border-purple-900/60">
                <div>
                  <div className="font-bold text-purple-950 dark:text-purple-200">VIP Recliner</div>
                  <div className="text-[10px] text-purple-600 dark:text-purple-400">Electric Recliner • Rows A–B</div>
                </div>
                <span className="font-extrabold text-purple-900 dark:text-purple-300 text-sm">₹500</span>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60">
                <div>
                  <div className="font-bold text-indigo-950 dark:text-indigo-200">Premium</div>
                  <div className="text-[10px] text-indigo-600 dark:text-indigo-400">Prime Viewing • Rows C–F</div>
                </div>
                <span className="font-extrabold text-indigo-900 dark:text-indigo-300 text-sm">₹350</span>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/60">
                <div>
                  <div className="font-bold text-blue-950 dark:text-blue-200">Standard</div>
                  <div className="text-[10px] text-blue-600 dark:text-blue-400">Stadium Seating • Rows G–K</div>
                </div>
                <span className="font-extrabold text-blue-900 dark:text-blue-300 text-sm">₹250</span>
              </div>
            </div>
          </div>

          {/* Action CTA Button */}
          <button
            onClick={() => onProceedToBooking({
              movie: selectedMovie,
              cinema: CINEMAS.find(c => c.id === activeShowtime?.cinemaId) || CINEMAS[0],
              showtime: activeShowtime,
              date: selectedDate
            })}
            className="w-full py-4 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-md shadow-indigo-600/30 hover:shadow-indigo-600/50 hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>Select Seats & Book</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>Guaranteed Instant Seat Allocation</span>
          </div>
        </div>
      </div>
    </div>
  );
}
