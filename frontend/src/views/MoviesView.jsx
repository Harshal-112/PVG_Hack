import React, { useState, useMemo } from 'react';
import MovieCard from '../components/MovieCard';
import { MOVIES, GENRES, FORMATS } from '../data/mockData';
import { 
  Search, 
  Filter, 
  RotateCcw, 
  SlidersHorizontal, 
  Film, 
  Star,
  Check
} from 'lucide-react';

export default function MoviesView({ 
  onSelectMovie, 
  onBookNow, 
  globalSearchQuery = '',
  setGlobalSearchQuery
}) {
  const [activeTab, setActiveTab] = useState('now_showing'); // 'now_showing' | 'coming_soon'
  const [selectedGenre, setSelectedGenre] = useState('All Genres');
  const [selectedFormat, setSelectedFormat] = useState('All Formats');
  const [minRating, setMinRating] = useState(0);
  const [localSearch, setLocalSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const query = (localSearch || globalSearchQuery).toLowerCase().trim();

  // Filter movies
  const filteredMovies = useMemo(() => {
    return MOVIES.filter((m) => {
      // Release type filter (Now showing vs coming soon)
      if (m.releaseType !== activeTab) return false;

      // Genre filter
      if (selectedGenre !== 'All Genres' && !m.genre.includes(selectedGenre)) {
        return false;
      }

      // Format filter
      if (selectedFormat !== 'All Formats' && !m.formats.includes(selectedFormat)) {
        return false;
      }

      // Rating filter
      if (minRating > 0 && m.rating < minRating) {
        return false;
      }

      // Search Query filter
      if (query) {
        const titleMatch = m.title.toLowerCase().includes(query);
        const genreMatch = m.genre.some(g => g.toLowerCase().includes(query));
        const directorMatch = m.director?.toLowerCase().includes(query);
        if (!titleMatch && !genreMatch && !directorMatch) return false;
      }

      return true;
    });
  }, [activeTab, selectedGenre, selectedFormat, minRating, query]);

  const handleResetFilters = () => {
    setSelectedGenre('All Genres');
    setSelectedFormat('All Formats');
    setMinRating(0);
    setLocalSearch('');
    if (setGlobalSearchQuery) setGlobalSearchQuery('');
  };

  return (
    <div className="space-y-8 animate-fadeIn pb-16">
      
      {/* 1. Page Header matching Frame 4 */}
      <div className="space-y-2 pt-2">
        <span className="text-[11px] font-extrabold tracking-widest text-indigo-600 dark:text-indigo-400 uppercase">
          Catalog & Discovery
        </span>
        <h2 className="text-2xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight">
          Big stories. Bigger screens.
        </h2>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-xl">
          Explore current blockbusters, indie favorites, and next-generation IMAX and 4DX immersive presentations.
        </p>
      </div>

      {/* 2. Top Bar: Now Showing / Coming Soon + Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        
        {/* Release Status Tabs */}
        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 p-1.5 rounded-2xl w-fit">
          <button
            onClick={() => setActiveTab('now_showing')}
            className={`px-5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'now_showing'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Now Showing
          </button>
          <button
            onClick={() => setActiveTab('coming_soon')}
            className={`px-5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'coming_soon'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Coming Soon
          </button>
        </div>

        {/* Search & Filter Trigger */}
        <div className="flex items-center gap-3">
          <div className="relative w-full sm:w-72">
            <input
              type="text"
              placeholder="Search by title, director, genre..."
              value={localSearch || globalSearchQuery}
              onChange={(e) => {
                setLocalSearch(e.target.value);
                if (setGlobalSearchQuery) setGlobalSearchQuery(e.target.value);
              }}
              className="w-full pl-9 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-sm"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          </div>

          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-750 shadow-sm cursor-pointer"
            aria-label="Filter"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 3. Main Content: Sidebar + Movie Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
        
        {/* Left Filter Sidebar */}
        <aside className={`lg:block ${sidebarOpen ? 'block' : 'hidden'} bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 space-y-6 shadow-sm sticky top-24 transition-colors`}>
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
              <Filter className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>Filters</span>
            </div>
            <button
              onClick={handleResetFilters}
              className="text-xs font-semibold text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          </div>

          {/* Genre Filters */}
          <div>
            <label className="text-xs font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-3">
              Genres
            </label>
            <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
              {GENRES.map((g) => {
                const isSelected = selectedGenre === g;
                return (
                  <button
                    key={g}
                    onClick={() => setSelectedGenre(g)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span>{g}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Formats Filter */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
            <label className="text-xs font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-3">
              Format
            </label>
            <div className="flex flex-wrap gap-1.5">
              {FORMATS.map((f) => {
                const isSelected = selectedFormat === f;
                return (
                  <button
                    key={f}
                    onClick={() => setSelectedFormat(f)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {f}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Rating Filter */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
            <label className="text-xs font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-2">
              Minimum Rating
            </label>
            <div className="flex items-center gap-2">
              {[0, 4.0, 4.5, 4.8].map((r) => (
                <button
                  key={r}
                  onClick={() => setMinRating(r)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    minRating === r
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {r === 0 ? 'All' : `${r}★`}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Right Grid of Movie Cards (3 columns in lg) */}
        <div className="lg:col-span-3 space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1">
            <span>
              Showing <strong className="text-slate-800 dark:text-slate-200">{filteredMovies.length}</strong> {filteredMovies.length === 1 ? 'title' : 'titles'}
            </span>
            <span className="font-semibold text-indigo-600 dark:text-indigo-400">
              {activeTab === 'now_showing' ? '● Screening In Theatres' : '● Upcoming Release'}
            </span>
          </div>

          {filteredMovies.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
              {filteredMovies.map((movie) => (
                <MovieCard
                  key={movie.id}
                  movie={movie}
                  onSelectMovie={onSelectMovie}
                  onBookNow={onBookNow}
                />
              ))}
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-12 text-center space-y-3">
              <Film className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto" />
              <h3 className="text-base font-bold text-slate-800 dark:text-white">
                No matching movies found
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                Try clearing your genre or format filters, or search for a different movie title.
              </p>
              <button
                onClick={handleResetFilters}
                className="mt-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 transition-colors cursor-pointer"
              >
                Reset All Filters
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
