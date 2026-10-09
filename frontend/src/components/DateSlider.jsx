import React from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';

export default function DateSlider({ selectedDate, onSelectDate }) {
  // Generate next 7 days
  const daysList = Array.from({ length: 7 }).map((_, index) => {
    const d = new Date();
    d.setDate(d.getDate() + index);

    const isToday = index === 0;
    const isTomorrow = index === 1;

    const dayName = isToday ? 'TODAY' : isTomorrow ? 'TOMORROW' : d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    const dayNumber = d.getDate();
    const monthName = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    const fullDateKey = d.toISOString().split('T')[0];

    return {
      key: fullDateKey,
      dayName,
      dayNumber,
      monthName,
      label: `${dayName}, ${dayNumber} ${monthName}`,
    };
  });

  return (
    <div className="relative">
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
        {daysList.map((item) => {
          const isSelected = selectedDate === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onSelectDate(item.key)}
              className={`flex-shrink-0 flex flex-col items-center justify-center min-w-[76px] sm:min-w-[88px] py-3 px-3 rounded-2xl border transition-all duration-200 cursor-pointer ${
                isSelected
                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-600/30 -translate-y-0.5'
                  : 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-indigo-300 dark:hover:border-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <span className={`text-[10px] font-bold tracking-wider ${isSelected ? 'text-indigo-200' : 'text-slate-400 dark:text-slate-500'}`}>
                {item.dayName}
              </span>
              <span className="text-xl sm:text-2xl font-black my-0.5">
                {item.dayNumber}
              </span>
              <span className={`text-[10px] font-semibold ${isSelected ? 'text-indigo-100' : 'text-slate-500 dark:text-slate-400'}`}>
                {item.monthName}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
