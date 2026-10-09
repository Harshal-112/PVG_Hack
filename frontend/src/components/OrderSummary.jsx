import React, { useState } from 'react';
import { Ticket, ShieldCheck, Sparkles, AlertCircle, ArrowRight, Lock } from 'lucide-react';

export default function OrderSummary({
  movie,
  cinema,
  showtime,
  date,
  selectedSeats,
  onRemoveSeat,
  onProceedToPayment,
  isProcessing
}) {
  const [promoCode, setPromoCode] = useState('');
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [promoMessage, setPromoMessage] = useState(null);

  // Subtotal calculation
  const subtotal = selectedSeats.reduce((acc, seat) => acc + (seat.price || 250), 0);
  const convenienceFee = selectedSeats.length > 0 ? Math.round(selectedSeats.length * 28) : 0;
  const grandTotal = Math.max(0, subtotal + convenienceFee - promoDiscount);

  const handleApplyPromo = (e) => {
    e.preventDefault();
    if (!promoCode.trim()) return;

    if (promoCode.trim().toUpperCase() === 'FLASH50' || promoCode.trim().toUpperCase() === 'FLASHPASS') {
      const discount = Math.round(subtotal * 0.2); // 20% discount
      setPromoDiscount(discount);
      setPromoMessage({ type: 'success', text: `Promo applied! You saved ₹${discount}` });
    } else {
      setPromoDiscount(0);
      setPromoMessage({ type: 'error', text: 'Invalid promo code. Try "FLASHPASS"' });
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm sticky top-24">
      {/* Title */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
        <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Ticket className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <span>Booking Summary</span>
        </h3>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
          Live Gateway
        </span>
      </div>

      {/* Selected Movie Info */}
      <div className="flex items-center gap-3 py-4 border-b border-slate-100 dark:border-slate-800">
        <img
          src={movie?.poster}
          alt={movie?.title}
          className="w-14 h-16 object-cover rounded-xl bg-slate-900 shadow-sm flex-shrink-0"
          onError={(e) => {
            e.target.src = '/posters/beyond_the_blue.png';
          }}
        />
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
            {movie?.title || 'Selected Movie'}
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {cinema?.name || 'Grand Multiplex'}
          </p>
          <div className="flex items-center gap-2 text-[11px] font-medium text-slate-600 dark:text-slate-300 mt-1">
            <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
              {showtime?.format || '2D'}
            </span>
            <span>•</span>
            <span className="text-indigo-600 dark:text-indigo-400 font-bold">{showtime?.time || '10:30 AM'}</span>
          </div>
        </div>
      </div>

      {/* Selected Seats Chips */}
      <div className="py-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
            Selected Seats ({selectedSeats.length})
          </span>
          {selectedSeats.length === 0 && (
            <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">Pick a seat on the left</span>
          )}
        </div>

        {selectedSeats.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {selectedSeats.map((seat) => (
              <span
                key={seat.code}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800"
              >
                <span>{seat.code}</span>
                <span className="text-[10px] text-indigo-400 font-normal">({seat.tier})</span>
                <button
                  type="button"
                  onClick={() => onRemoveSeat(seat.code)}
                  className="hover:text-rose-600 transition-colors ml-0.5"
                  title="Remove seat"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-dashed border-slate-200 dark:border-slate-700 text-center text-xs text-slate-400">
            No seats selected yet. Click on the seats in the grid to reserve.
          </div>
        )}
      </div>

      {/* Pricing Breakdown */}
      <div className="py-4 space-y-2 text-xs">
        <div className="flex justify-between text-slate-600 dark:text-slate-400">
          <span>Tickets Subtotal</span>
          <span className="font-semibold text-slate-800 dark:text-slate-200">₹{subtotal.toFixed(2)}</span>
        </div>

        <div className="flex justify-between text-slate-600 dark:text-slate-400">
          <span>Convenience Fee & Taxes</span>
          <span className="font-semibold text-slate-800 dark:text-slate-200">₹{convenienceFee.toFixed(2)}</span>
        </div>

        {promoDiscount > 0 && (
          <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
            <span>Promo Discount (FLASHPASS)</span>
            <span>- ₹{promoDiscount.toFixed(2)}</span>
          </div>
        )}

        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-between items-baseline">
          <span className="text-sm font-bold text-slate-900 dark:text-white">Total Payable</span>
          <span className="text-xl font-extrabold text-indigo-600 dark:text-indigo-400">
            ₹{grandTotal.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Promo Code Input */}
      <form onSubmit={handleApplyPromo} className="pt-2 pb-4">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder='Promo code: "FLASHPASS"'
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value)}
            className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-white uppercase placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
          />
          <button
            type="submit"
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
          >
            Apply
          </button>
        </div>
        {promoMessage && (
          <div className={`mt-2 text-[11px] font-semibold ${promoMessage.type === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {promoMessage.text}
          </div>
        )}
      </form>

      {/* Proceed to Payment Gateway Button */}
      <button
        type="button"
        disabled={selectedSeats.length === 0 || isProcessing}
        onClick={() => onProceedToPayment({ grandTotal, subtotal, convenienceFee, promoDiscount })}
        className={`w-full py-3.5 px-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all duration-200 shadow-md ${
          selectedSeats.length > 0 && !isProcessing
            ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30 hover:shadow-indigo-600/50 hover:-translate-y-0.5 cursor-pointer'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 border border-slate-200 dark:border-slate-700 cursor-not-allowed shadow-none'
        }`}
      >
        <Lock className="w-4 h-4" />
        <span>Proceed to Pay (₹{grandTotal.toFixed(2)})</span>
        <ArrowRight className="w-4 h-4 ml-1" />
      </button>

      {/* Trust and Guarantee Note */}
      <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
        <span>Google Pay UPI & Razorpay Supported</span>
      </div>
    </div>
  );
}
