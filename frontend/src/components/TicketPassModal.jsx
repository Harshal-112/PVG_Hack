import React from 'react';
import { 
  CheckCircle2, 
  Download, 
  Calendar, 
  MapPin, 
  Ticket, 
  Clock, 
  X, 
  Share2,
  Sparkles,
  ShieldCheck 
} from 'lucide-react';

export default function TicketPassModal({ booking, onClose, onViewBookings }) {
  if (!booking) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 transition-colors">
        
        {/* Modal Top Green Header */}
        <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 text-white p-5 text-center relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-2 backdrop-blur-sm shadow-inner">
            <CheckCircle2 className="w-7 h-7 text-white" />
          </div>
          <h3 className="text-lg font-black tracking-tight">
            Booking Confirmed!
          </h3>
          <p className="text-xs text-emerald-100 font-medium">
            Payment verified • Official Cinema E-Ticket
          </p>
        </div>

        {/* Boarding Pass Body */}
        <div className="p-6">
          {/* Cinema & Reference Strip */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 text-xs">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                Booking ID
              </span>
              <span className="font-mono font-extrabold text-slate-800 dark:text-white text-sm">
                {booking.bookingId}
              </span>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                Status
              </span>
              <span className="inline-flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-400 text-xs">
                ● Confirmed & Active
              </span>
            </div>
          </div>

          {/* Movie Details */}
          <div className="flex gap-3 py-4 border-b border-slate-100 dark:border-slate-800">
            <img
              src={booking.movie?.poster}
              alt={booking.movie?.title}
              className="w-14 h-20 object-cover rounded-xl bg-slate-900 shadow-sm flex-shrink-0"
              onError={(e) => {
                e.target.src = '/posters/beyond_the_blue.png';
              }}
            />
            <div className="flex flex-col justify-between">
              <div>
                <h4 className="text-base font-bold text-slate-900 dark:text-white leading-tight">
                  {booking.movie?.title}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {booking.movie?.genre?.join(' • ') || 'Feature Film'}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <span className="px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 font-bold text-[10px]">
                  {booking.format || 'Dolby Atmos'}
                </span>
                <span>•</span>
                <span>{booking.movie?.duration || '1h 50m'}</span>
              </div>
            </div>
          </div>

          {/* Screening Meta Grid */}
          <div className="grid grid-cols-2 gap-3 py-3 border-b border-slate-100 dark:border-slate-800 text-xs">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                Theatre & Screen
              </span>
              <span className="font-bold text-slate-800 dark:text-slate-200 block truncate">
                {booking.cinema}
              </span>
            </div>

            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                Date & Time
              </span>
              <span className="font-bold text-indigo-600 dark:text-indigo-400 block">
                {booking.date} • {booking.time}
              </span>
            </div>

            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                Seats Reserved
              </span>
              <div className="flex flex-wrap items-center gap-1 mt-0.5">
                {(booking.seats || []).map((seatCode) => (
                  <span
                    key={seatCode}
                    className="px-2 py-0.5 rounded font-extrabold bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-[11px]"
                  >
                    {seatCode}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                Amount Paid
              </span>
              <span className="font-extrabold text-slate-900 dark:text-emerald-400 text-sm">
                ₹{Number(booking.totalAmount || 0).toFixed(2)}
              </span>
            </div>
          </div>

          {/* Scannable QR Code Section */}
          <div className="py-4 flex flex-col items-center justify-center bg-slate-50/80 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800 my-3">
            <div className="p-2.5 bg-white rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
              {/* Dynamic QR Code representation */}
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=FLASHSEAT_VERIFY:${booking.bookingId}:${(booking.seats || []).join(',')}`}
                alt="Ticket QR Code"
                className="w-28 h-28 object-contain"
                onError={(e) => {
                  e.target.src = '/posters/upi_qr.png';
                }}
              />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mt-2">
              Scan at Cinema Gate
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={onViewBookings}
              className="flex-1 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md shadow-indigo-600/25 transition-all text-center cursor-pointer"
            >
              View in My Bookings
            </button>
            <button
              onClick={() => {
                alert(`Downloaded Pass for ${booking.movie?.title} (${booking.bookingId})`);
              }}
              className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors flex items-center justify-center cursor-pointer"
              title="Download Ticket PDF"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}