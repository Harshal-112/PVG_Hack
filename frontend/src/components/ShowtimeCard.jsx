import React from 'react';
import { MapPin, Sparkles, CheckCircle2 } from 'lucide-react';

export default function ShowtimeCard({ 
  cinema, 
  selectedShowtime, 
  onSelectShowtime 
}) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-5 shadow-sm hover:shadow-md transition-shadow">
      {/* Cinema Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-base font-bold text-slate-900 dark:text-white">
              {cinema.name}
            </h4>
            {cinema.cancellation && (
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                <CheckCircle2 className="w-3 h-3" /> Cancellation Available
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-slate-400" />
              {cinema.venue}
            </span>
            <span>•</span>
            <span className="font-semibold text-slate-600 dark:text-slate-300">{cinema.distance}</span>
          </div>
        </div>

        {/* Amenities Pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {cinema.amenities.map((item, idx) => (
            <span 
              key={idx}
              className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700"
            >
              {item}
            </span>
          ))}
        </div>
      </div>

      {/* Showtimes Row */}
      <div className="pt-4">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-2.5">
          Select Showtime
        </span>
        <div className="flex items-center gap-2.5 flex-wrap">
          {cinema.showtimes.map((slot) => {
            const isSelected = selectedShowtime?.id === slot.id && selectedShowtime?.cinemaId === cinema.id;

            // Status color helper
            let statusBadge = null;
            if (slot.status === 'filling_fast') {
              statusBadge = <span className="text-[9px] font-semibold text-amber-600 dark:text-amber-400 block">Filling Fast</span>;
            } else if (slot.status === 'popular') {
              statusBadge = <span className="text-[9px] font-semibold text-indigo-600 dark:text-indigo-400 block">Popular</span>;
            } else if (slot.status === 'almost_full') {
              statusBadge = <span className="text-[9px] font-semibold text-rose-600 dark:text-rose-400 block">Few Seats</span>;
            } else {
              statusBadge = <span className="text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 block">Available</span>;
            }

            return (
              <button
                key={slot.id}
                onClick={() => onSelectShowtime({ ...slot, cinemaId: cinema.id, cinemaName: cinema.name })}
                className={`flex flex-col items-center justify-center min-w-[96px] py-2 px-3 rounded-xl border transition-all ${
                  isSelected
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-600/30 ring-2 ring-indigo-500/30'
                    : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 hover:border-indigo-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200'
                }`}
              >
                <span className="text-xs sm:text-sm font-black tracking-tight">
                  {slot.time}
                </span>
                <span className="text-[9px] font-semibold opacity-80 uppercase mt-0.5">
                  {slot.format}
                </span>
                <div className="mt-0.5">
                  {isSelected ? (
                    <span className="text-[9px] font-bold text-indigo-200 block">Selected</span>
                  ) : (
                    statusBadge
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
