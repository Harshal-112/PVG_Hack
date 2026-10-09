import React from 'react';
import { SEAT_TIERS } from '../data/mockData';
import { Check, Armchair, UserCheck, Lock } from 'lucide-react';

export default function SeatMatrix({ 
  selectedSeats = [], 
  onToggleSeat, 
  bookedSeats = ['C4', 'C5', 'F6', 'F7', 'G3', 'G4', 'J8', 'B3'],
  userBookedSeats = [],
  heldSeats = {},
  currentUserId = null
}) {
  const isSeatSelected = (seatCode) => selectedSeats.some((s) => s.code === seatCode);
  const isSeatBooked = (seatCode) => bookedSeats.includes(seatCode);
  const isUserBooked = (seatCode) => userBookedSeats.includes(seatCode);
  const getHoldInfo = (seatCode) => {
    const hold = heldSeats[seatCode];
    if (hold && (!currentUserId || hold.userId !== currentUserId)) {
      return hold;
    }
    return null;
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 sm:p-8 shadow-sm transition-colors">
      {/* Screen Curved Header */}
      <div className="flex flex-col items-center mb-10">
        <div className="w-full max-w-lg h-3 rounded-t-full bg-gradient-to-r from-indigo-200 via-indigo-600 to-indigo-200 dark:from-indigo-900 dark:via-indigo-500 dark:to-indigo-900 opacity-90 shadow-lg shadow-indigo-500/20" />
        <div className="w-full max-w-md h-8 screen-glow -mt-1 rounded-b-3xl opacity-60 pointer-events-none" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mt-2">
          All Eyes This Way Please • Cinema Screen
        </span>
      </div>

      {/* Seat Rows by Tier */}
      <div className="space-y-8 max-w-2xl mx-auto overflow-x-auto pb-4">
        {Object.entries(SEAT_TIERS).map(([tierKey, tier]) => {
          return (
            <div key={tierKey} className="space-y-2.5">
              {/* Tier Header with Price Pill */}
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2 mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                    {tier.name}
                  </span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 hidden sm:inline">
                    ({tier.desc})
                  </span>
                </div>
                <div className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  ₹{tier.price}
                </div>
              </div>

              {/* Rows within this tier */}
              <div className="space-y-2">
                {tier.rows.map((rowLetter) => (
                  <div key={rowLetter} className="flex items-center justify-center gap-2 sm:gap-3">
                    {/* Left Row Identifier */}
                    <span className="w-5 text-xs font-bold text-slate-400 dark:text-slate-500 text-center">
                      {rowLetter}
                    </span>

                    {/* Seats in Row */}
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      {Array.from({ length: tier.seatsPerRow }).map((_, seatIdx) => {
                        const seatNum = seatIdx + 1;
                        const seatCode = `${rowLetter}${seatNum}`;
                        const booked = isSeatBooked(seatCode);
                        const userBooked = isUserBooked(seatCode);
                        const holdInfo = getHoldInfo(seatCode);
                        const isHeld = !!holdInfo;
                        const selected = isSeatSelected(seatCode);
                        
                        // Middle aisle gap
                        const isMiddleGap = seatNum === Math.floor(tier.seatsPerRow / 2);

                        let seatClasses = "w-7 h-7 sm:w-8 sm:h-8 rounded-lg text-[10px] sm:text-xs font-bold flex items-center justify-center transition-all duration-200 ";

                        if (userBooked) {
                          // Seats booked by active user
                          seatClasses += "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700 cursor-not-allowed shadow-inner";
                        } else if (booked) {
                          // Seats booked by others / sold out
                          seatClasses += "bg-slate-100 dark:bg-slate-800/60 text-slate-300 dark:text-slate-600 border border-slate-200 dark:border-slate-800 cursor-not-allowed";
                        } else if (isHeld) {
                          // Seats held in active checkout by another tab/user
                          seatClasses += "bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border border-amber-300 dark:border-amber-700 cursor-not-allowed animate-pulse";
                        } else if (selected) {
                          // Currently selected seats
                          seatClasses += "bg-indigo-600 text-white border border-indigo-600 shadow-md shadow-indigo-600/40 scale-105 ring-2 ring-indigo-400/50 cursor-pointer";
                        } else {
                          // Available seats
                          seatClasses += "bg-slate-50 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950 text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:scale-105 cursor-pointer";
                        }

                        let tooltipText = `${seatCode} • ${tier.name} (₹${tier.price})`;
                        if (userBooked) {
                          tooltipText = `${seatCode} • Reserved by You (Confirmed Booking)`;
                        } else if (booked) {
                          tooltipText = `${seatCode} • Sold Out / Confirmed by another customer`;
                        } else if (isHeld) {
                          tooltipText = `${seatCode} • In Checkout (Held by ${holdInfo.userName || 'Customer'})`;
                        }

                        return (
                          <React.Fragment key={seatCode}>
                            <button
                              type="button"
                              disabled={booked || userBooked || isHeld}
                              onClick={() => onToggleSeat({
                                code: seatCode,
                                row: rowLetter,
                                num: seatNum,
                                tier: tier.name,
                                tierCode: tierKey,
                                price: tier.price
                              })}
                              className={seatClasses}
                              title={tooltipText}
                              aria-label={tooltipText}
                            >
                              {selected ? (
                                <Check className="w-3.5 h-3.5 stroke-[3]" />
                              ) : userBooked ? (
                                <span className="flex items-center justify-center text-[9px] font-extrabold text-emerald-600 dark:text-emerald-400">
                                  ✓
                                </span>
                              ) : isHeld ? (
                                <Lock className="w-3 h-3 text-amber-500" />
                              ) : (
                                seatNum
                              )}
                            </button>
                            {isMiddleGap && <div className="w-3 sm:w-5" />}
                          </React.Fragment>
                        );
                      })}
                    </div>

                    {/* Right Row Identifier */}
                    <span className="w-5 text-xs font-bold text-slate-400 dark:text-slate-500 text-center">
                      {rowLetter}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Seat States Legend */}
      <div className="flex items-center justify-center gap-4 sm:gap-6 pt-8 mt-6 border-t border-slate-100 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-400 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700" />
          <span>Available</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-indigo-600 border border-indigo-600 text-white flex items-center justify-center text-[8px] font-bold">
            ✓
          </div>
          <span>Selected</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-[8px] font-bold">
            ✓
          </div>
          <span>Booked by You</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400 flex items-center justify-center text-[8px] font-bold">
            🔒
          </div>
          <span>In Checkout / Held</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800" />
          <span className="text-slate-400 dark:text-slate-600">Sold Out</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800" />
          <span>VIP Recliner</span>
        </div>
      </div>
    </div>
  );
}
