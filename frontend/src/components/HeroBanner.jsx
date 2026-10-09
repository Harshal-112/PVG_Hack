import React from 'react';
import { Play, Ticket, Sparkles, Star } from 'lucide-react';

export default function HeroBanner({ movie, onBookNow, onWatchTrailer }) {
  if (!movie) return null;

  return (
    <div className="relative rounded-3xl overflow-hidden bg-slate-950 text-white shadow-2xl border border-slate-800">
      {/* Background Poster Overlay with gradient */}
      <div className="absolute inset-0 z-0">
        <img
          src={movie.banner || movie.poster}
          alt={movie.title}
          className="w-full h-full object-cover object-center opacity-40 mix-blend-luminosity scale-105"
          onError={(e) => {
            e.target.src = '/posters/beyond_the_blue.png';
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/80 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent opacity-90" />
      </div>

      {/* Hero Content */}
      <div className="relative z-10 px-6 py-10 sm:px-10 sm:py-14 max-w-2xl">
        {/* Featured Tag */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 text-xs font-bold tracking-wide uppercase mb-4 backdrop-blur-md">
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          <span>Featured Premiere</span>
        </div>

        {/* Title */}
        <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white mb-3 leading-tight drop-shadow-md">
          {movie.title}
        </h1>

        {/* Metadata Strip */}
        <div className="flex items-center gap-2.5 sm:gap-3 text-xs sm:text-sm text-slate-300 mb-4 flex-wrap">
          <div className="flex items-center gap-1 text-amber-400 font-bold">
            <Star className="w-4 h-4 fill-amber-400" />
            <span>{movie.rating}</span>
          </div>
          <span>•</span>
          <span className="font-medium text-slate-200">{movie.genre.join(' / ')}</span>
          <span>•</span>
          <span>{movie.duration}</span>
          <span>•</span>
          <span className="px-2 py-0.5 rounded bg-white/10 text-[11px] font-bold text-indigo-200">
            {movie.formats.join(' • ')}
          </span>
        </div>

        {/* Synopsis */}
        <p className="text-slate-300 text-sm sm:text-base leading-relaxed mb-8 line-clamp-3 font-normal max-w-xl">
          {movie.description}
        </p>

        {/* CTA Buttons */}
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
          <button
            onClick={() => onBookNow(movie)}
            className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-lg shadow-indigo-600/40 hover:shadow-indigo-600/60 hover:-translate-y-0.5 transition-all duration-200"
          >
            <Ticket className="w-4 h-4" />
            <span>Book Now</span>
          </button>

          <button
            onClick={onWatchTrailer}
            className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-white/10 hover:bg-white/15 text-white border border-white/20 backdrop-blur-md font-semibold text-sm hover:-translate-y-0.5 transition-all duration-200"
          >
            <Play className="w-4 h-4 fill-white text-white" />
            <span>Watch Trailer</span>
          </button>
        </div>
      </div>
    </div>
  );
}
