import React from 'react';
import { Star, Clock, Ticket } from 'lucide-react';

export default function MovieCard({ movie, onSelectMovie, onBookNow }) {
  const isComingSoon = movie.releaseType === 'coming_soon';

  return (
    <div className="group bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden shadow-sm hover:shadow-xl hover:border-indigo-200 dark:hover:border-indigo-800 transition-all duration-300 flex flex-col justify-between">
      <div>
        {/* Poster Container */}
        <div className="relative aspect-[16/10] overflow-hidden bg-slate-900 cursor-pointer" onClick={() => onSelectMovie(movie)}>
          <img
            src={movie.poster}
            alt={movie.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
            onError={(e) => {
              e.target.src = 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=600&auto=format&fit=crop&q=80';
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-black/20 opacity-80 group-hover:opacity-60 transition-opacity" />

          {/* Formats Tag Badge */}
          <div className="absolute top-3 left-3 flex gap-1.5 flex-wrap">
            <span className="px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-black/60 text-white backdrop-blur-md border border-white/20">
              {movie.formats[0] || '2D'}
            </span>
            {isComingSoon && (
              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-amber-500 text-white shadow-sm">
                Coming Soon
              </span>
            )}
          </div>

          {/* Star Rating Badge */}
          <div className="absolute bottom-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/80 backdrop-blur-md border border-white/10 text-white text-xs font-bold">
            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            <span>{movie.rating}</span>
            <span className="text-[10px] text-slate-400 font-normal">({movie.reviewCount})</span>
          </div>

          {/* Certification Badge */}
          <div className="absolute bottom-3 right-3 px-2 py-0.5 rounded text-[10px] font-bold bg-white/20 text-white backdrop-blur-md">
            {movie.cert}
          </div>
        </div>

        {/* Content details */}
        <div className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <h3 
              onClick={() => onSelectMovie(movie)}
              className="text-base font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors line-clamp-1 cursor-pointer"
            >
              {movie.title}
            </h3>
          </div>

          {/* Genre & Duration */}
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-3 flex-wrap">
            <span>{movie.genre.join(', ')}</span>
            <span>•</span>
            <div className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>{movie.duration}</span>
            </div>
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed mb-4">
            {movie.description}
          </p>
        </div>
      </div>

      {/* Card Footer with Price & Book CTA */}
      <div className="px-4 pb-4 sm:px-5 sm:pb-5 pt-0 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between mt-auto">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
            Ticket Price
          </span>
          <span className="text-sm font-extrabold text-slate-900 dark:text-white">
            From ₹{movie.priceFrom}
          </span>
        </div>

        <button
          onClick={() => onBookNow(movie)}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 shadow-sm ${
            isComingSoon
              ? 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
              : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/25 hover:shadow-md'
          }`}
        >
          <Ticket className="w-3.5 h-3.5" />
          {isComingSoon ? 'Notify Me' : 'Book Ticket'}
        </button>
      </div>
    </div>
  );
}
