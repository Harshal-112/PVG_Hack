import React, { useState, useMemo, useEffect, useCallback } from 'react';
import SeatMatrix from '../components/SeatMatrix';
import OrderSummary from '../components/OrderSummary';
import TicketPassModal from '../components/TicketPassModal';
import PaymentGatewayModal from '../components/PaymentGatewayModal';
import { 
  getScreeningId,
  getSharedBookings,
  getSharedHolds,
  fetchSharedHolds,
  fetchLockedSeats,
  acquireSeatHold,
  releaseSeatHold,
  atomicConfirmBooking,
  subscribeToInventoryUpdates
} from '../services/inventorySync';
import { MOVIES, CINEMAS, INITIAL_BOOKINGS } from '../data/mockData';
import { 
  ArrowLeft, 
  Ticket, 
  Calendar, 
  Clock, 
  MapPin, 
  History, 
  QrCode, 
  Download, 
  CheckCircle2, 
  Trash2,
  Sparkles,
  Lock,
  UserCheck,
  AlertTriangle,
  ShieldAlert,
  X
} from 'lucide-react';

export default function BookingView({
  bookingState,
  onBackToShowtimes,
  bookingsList,
  onAddBooking,
  onCancelBooking,
  currentUser,
  onOpenLogin
}) {
  const [subTab, setSubTab] = useState('seats'); // 'seats' | 'history'
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState(null);
  const [viewingPass, setViewingPass] = useState(null);
  const [paymentModalData, setPaymentModalData] = useState(null);
  const [authNotice, setAuthNotice] = useState(false);

  // Live Collision / Conflict alert state
  const [collisionAlert, setCollisionAlert] = useState(null);
  const [activeHoldsMap, setActiveHoldsMap] = useState({});
  const [lockedSeats, setLockedSeats] = useState([]);

  const {
    movie = MOVIES[0],
    cinema = CINEMAS[0],
    showtime = { id: 'st3', time: '05:15 PM', format: 'Dolby Atmos', screen: 'Screen 2' },
    date = 'Today, 25 Oct 2026'
  } = bookingState || {};

  // Canonical screening ID for atomic locking
  const screeningId = useMemo(() => {
    return getScreeningId(movie, cinema, date, showtime?.time);
  }, [movie, cinema, date, showtime]);

  // Sync active holds and locked seats for this screening from Supabase
  const refreshHolds = useCallback(async () => {
    const holds = await fetchSharedHolds(screeningId);
    if (holds) setActiveHoldsMap(holds);
  }, [screeningId]);

  const refreshLockedSeats = useCallback(async () => {
    const seats = await fetchLockedSeats(screeningId);
    if (seats) setLockedSeats(seats);
  }, [screeningId]);

  useEffect(() => {
    refreshHolds();
    refreshLockedSeats();
  }, [refreshHolds, refreshLockedSeats]);

  // Subscribe to real-time events across other tabs & devices
  useEffect(() => {
    const unsubscribe = subscribeToInventoryUpdates((payload) => {
      refreshHolds();
      refreshLockedSeats();

      if (payload.type === 'BOOKING_COMMITTED' || payload.type === 'LOCKED_SEATS_CHANGE') {
        const bookedInOther = payload.booking?.seats || (payload.payload?.new?.seat_code ? [payload.payload.new.seat_code] : []);
        const myConflictedSeats = selectedSeats.filter((s) => bookedInOther.includes(s.code));

        if (myConflictedSeats.length > 0) {
          const conflictingUser = payload.booking?.userName || payload.payload?.new?.user_name || 'another user';
          setCollisionAlert({
            title: 'Seat Conflict Detected!',
            message: `Seat ${myConflictedSeats.map(s => s.code).join(', ')} was just booked by ${conflictingUser} on another device. Removed from your selection to avoid collision.`,
            type: 'error'
          });

          // Automatically unselect conflicted seats
          setSelectedSeats((prev) => prev.filter((s) => !bookedInOther.includes(s.code)));
        }
      } else if (payload.type === 'SEATS_HELD' && payload.screeningId === screeningId) {
        if (currentUser && payload.user?.email !== currentUser.email) {
          const heldByOther = payload.seats || [];
          const myConflicted = selectedSeats.filter((s) => heldByOther.includes(s.code));
          if (myConflicted.length > 0) {
            setCollisionAlert({
              title: 'Seat Held by Another User',
              message: `Seat ${myConflicted.map(s => s.code).join(', ')} is currently held in checkout by ${payload.user?.name || 'another customer'}.`,
              type: 'warning'
            });
            setSelectedSeats((prev) => prev.filter((s) => !heldByOther.includes(s.code)));
          }
        }
      }
    });

    return unsubscribe;
  }, [screeningId, selectedSeats, currentUser, refreshHolds, refreshLockedSeats]);

  // Base pre-booked seats for realistic theatre simulation
  const baseBookedSeats = ['C4', 'C5', 'F6', 'F7', 'G3', 'G4', 'J8', 'B3'];

  // Dynamically calculate booked seats from confirmed bookings + Supabase locked seats
  const { currentScreeningBookedSeats, myBookedSeats } = useMemo(() => {
    const allBooked = new Set(baseBookedSeats);
    const userSeats = new Set();

    (bookingsList || []).forEach((b) => {
      if (b.status === 'CANCELLED') return;
      const bScreeningId = b.screeningId || getScreeningId(b.movie, b.cinema, b.date, b.time);

      if (bScreeningId === screeningId) {
        (b.seats || []).forEach((seatCode) => {
          allBooked.add(seatCode);
          if (currentUser && (b.userEmail === currentUser.email || b.userName === currentUser.name)) {
            userSeats.add(seatCode);
          }
        });
      }
    });

    // Also include seats locked directly in Supabase locked_seats table
    (lockedSeats || []).forEach((row) => {
      allBooked.add(row.seat_code);
      if (currentUser && (row.user_id === currentUser.email || row.user_id === currentUser.id)) {
        userSeats.add(row.seat_code);
      }
    });

    return {
      currentScreeningBookedSeats: Array.from(allBooked),
      myBookedSeats: Array.from(userSeats)
    };
  }, [bookingsList, screeningId, currentUser, lockedSeats]);

  // Auto-remove any newly booked seats from selection
  useEffect(() => {
    setSelectedSeats((prev) => prev.filter((s) => !currentScreeningBookedSeats.includes(s.code)));
  }, [currentScreeningBookedSeats]);

  // Toggle seat selection with lock acquisition
  const handleToggleSeat = async (seat) => {
    if (currentScreeningBookedSeats.includes(seat.code)) return;

    // Check if held by someone else
    const hold = activeHoldsMap[seat.code];
    if (hold && (!currentUser || hold.userId !== currentUser.email)) {
      setCollisionAlert({
        title: 'Seat In Progress',
        message: `Seat ${seat.code} is currently held in checkout by ${hold.userName || 'another user'}. Please pick another seat.`,
        type: 'warning'
      });
      return;
    }

    const exists = selectedSeats.some((s) => s.code === seat.code);
    if (exists) {
      // Release hold if deselected
      releaseSeatHold(screeningId, [seat.code], currentUser);
      setSelectedSeats((prev) => prev.filter((s) => s.code !== seat.code));
    } else {
      if (selectedSeats.length >= 8) {
        alert('You can select a maximum of 8 seats per booking transaction.');
        return;
      }
      // Optimistically add seat
      setSelectedSeats((prev) => [...prev, seat]);
      // Acquire remote lock
      const holdRes = await acquireSeatHold(screeningId, [seat.code], currentUser);
      if (!holdRes.success) {
        setSelectedSeats((prev) => prev.filter((s) => s.code !== seat.code));
        setCollisionAlert({
          title: 'Seat Unavailable',
          message: holdRes.message || `Seat ${seat.code} was claimed by another customer!`,
          type: 'warning'
        });
        refreshHolds();
        refreshLockedSeats();
      }
    }
  };

  const handleRemoveSeat = (seatCode) => {
    releaseSeatHold(screeningId, [seatCode], currentUser);
    setSelectedSeats((prev) => prev.filter((s) => s.code !== seatCode));
  };

  // Triggered from OrderSummary "Proceed to Pay" button
  const handleProceedToPayment = async ({ grandTotal, subtotal, convenienceFee, promoDiscount }) => {
    if (selectedSeats.length === 0) return;

    // 1. Check user authentication
    if (!currentUser) {
      setAuthNotice(true);
      if (onOpenLogin) onOpenLogin();
      return;
    }

    setAuthNotice(false);
    const seatCodes = selectedSeats.map((s) => s.code);

    // 2. ATOMIC PRE-PAYMENT SEAT LOCK: Verify no race condition has occurred
    const holdResult = await acquireSeatHold(screeningId, seatCodes, currentUser);
    if (!holdResult.success) {
      if (holdResult.reason === 'ALREADY_BOOKED') {
        setCollisionAlert({
          title: 'Collision Detected!',
          message: `Seat ${holdResult.conflictSeat} has already been confirmed by ${holdResult.bookedBy || 'another customer'}! High-contention lock engine prevented double booking.`,
          type: 'error'
        });
      } else if (holdResult.reason === 'ALREADY_HELD') {
        setCollisionAlert({
          title: 'Seat Held by Another User',
          message: `Seat ${holdResult.conflictSeat} is currently being checked out by ${holdResult.heldBy || 'another customer'}. Please select an alternate seat.`,
          type: 'warning'
        });
      } else {
        setCollisionAlert({
          title: 'Seat Lock Failed',
          message: holdResult.message || 'Could not place reservation hold. Please try another seat.',
          type: 'error'
        });
      }
      // Remove conflicting seat
      if (holdResult.conflictSeat) {
        setSelectedSeats((prev) => prev.filter((s) => s.code !== holdResult.conflictSeat));
      }
      refreshHolds();
      refreshLockedSeats();
      return;
    }

    // 3. Open Payment Gateway Modal
    setPaymentModalData({
      grandTotal,
      subtotal,
      convenienceFee,
      promoDiscount,
      movie,
      cinema: cinema?.name || 'Apex Grand Cinemas • Screen 2',
      date,
      time: showtime?.time || '05:15 PM',
      format: showtime?.format || 'Dolby Atmos',
      seats: seatCodes,
      tier: selectedSeats[0]?.tier || 'Premium',
    });
  };

  // Called when payment is successfully confirmed in PaymentGatewayModal
  const handlePaymentSuccess = async ({ paymentMethod, transactionId, orderId }) => {
    setIsProcessing(true);

    const newBooking = {
      bookingId: `FS-${Math.floor(1000 + Math.random() * 9000)}-2026`,
      movie,
      cinema: cinema?.name || 'Apex Grand Cinemas • Screen 2',
      date,
      time: showtime?.time || '05:15 PM',
      format: showtime?.format || 'Dolby Atmos',
      seats: selectedSeats.map((s) => s.code),
      tier: selectedSeats[0]?.tier || 'Premium',
      totalAmount: paymentModalData?.grandTotal || 756,
      status: 'CONFIRMED',
      paymentMethod: paymentMethod || 'UPI Instant Verification',
      transactionId: transactionId || `TXN-${Date.now()}`,
      userEmail: currentUser?.email || 'member@flashseat.demo',
      userName: currentUser?.name || 'FlashSeat Member',
      bookingDate: new Date().toLocaleString('en-US', { 
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' 
      }),
      isUpcoming: true,
    };

    // 4. ATOMIC CHECK-AND-COMMIT ENGINE:
    // Ensures zero double-booking even if two users click Pay at the exact same instant!
    const commitResult = await atomicConfirmBooking(newBooking, INITIAL_BOOKINGS);

    setIsProcessing(false);
    setPaymentModalData(null);

    if (!commitResult.success) {
      // COLLISION ENFORCED: Rollback!
      setCollisionAlert({
        title: 'Transaction Collision Blocked!',
        message: commitResult.message || 'Seat was claimed by another customer moments before payment. No charge was captured.',
        type: 'error'
      });
      // Purge conflicting seats
      if (commitResult.collisionSeats) {
        setSelectedSeats((prev) => prev.filter((s) => !commitResult.collisionSeats.includes(s.code)));
      }
      refreshHolds();
      refreshLockedSeats();
      return;
    }

    // SUCCESS: Booking is guaranteed unique
    onAddBooking(newBooking);
    setConfirmedBooking(newBooking);
    setSelectedSeats([]);
    refreshHolds();
    refreshLockedSeats();
  };

  return (
    <div className="space-y-6 sm:space-y-8 animate-fadeIn pb-16">
      
      {/* Sub-navigation tabs: Seat Selection vs Booking History */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        
        {/* Sub-tabs pills */}
        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 p-1.5 rounded-2xl w-fit">
          <button
            onClick={() => setSubTab('seats')}
            className={`flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              subTab === 'seats'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Ticket className="w-4 h-4" />
            <span>Seat Selection</span>
          </button>
          
          <button
            onClick={() => setSubTab('history')}
            className={`flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              subTab === 'history'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <History className="w-4 h-4" />
            <span>My Bookings & Wallet ({bookingsList.length})</span>
          </button>
        </div>

        {subTab === 'seats' && (
          <button
            onClick={onBackToShowtimes}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Change Showtime</span>
          </button>
        )}
      </div>

      {/* Collision & Race Condition Prevention Banner */}
      {collisionAlert && (
        <div className={`p-4 rounded-2xl border flex items-start justify-between gap-4 animate-fadeIn ${
          collisionAlert.type === 'error'
            ? 'bg-rose-50 dark:bg-rose-950/60 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200'
            : 'bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
        }`}>
          <div className="flex items-start gap-3">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${
              collisionAlert.type === 'error' ? 'bg-rose-600 text-white' : 'bg-amber-600 text-white'
            }`}>
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-black tracking-tight flex items-center gap-2">
                <span>{collisionAlert.title}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/60 dark:bg-black/30 font-bold uppercase tracking-wider">
                  Zero Double-Booking Engine
                </span>
              </h4>
              <p className="text-xs mt-1 leading-relaxed opacity-90">
                {collisionAlert.message}
              </p>
            </div>
          </div>
          <button
            onClick={() => setCollisionAlert(null)}
            className="p-1 rounded-lg hover:bg-black/10 transition-colors"
            aria-label="Dismiss alert"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Unauthenticated Alert Notice if user tried to pay without logging in */}
      {!currentUser && authNotice && (
        <div className="p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 flex items-center justify-between gap-4 animate-fadeIn">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                Account Required for Ticket Reservation
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Please sign in or create an account to securely reserve your seats and receive your QR boarding pass.
              </p>
            </div>
          </div>
          <button
            onClick={onOpenLogin}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition-all flex-shrink-0 cursor-pointer"
          >
            Sign In Now
          </button>
        </div>
      )}

      {/* VIEW 1: Seat Selection & Live Summary (Frame 3) */}
      {subTab === 'seats' && (
        <div className="space-y-6">
          
          {/* Header Card with movie info */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-5 sm:p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors">
            <div className="flex items-center gap-4">
              <img
                src={movie?.poster}
                alt={movie?.title}
                className="w-12 h-16 object-cover rounded-xl bg-slate-900 shadow-sm flex-shrink-0"
                onError={(e) => {
                  e.target.src = '/posters/beyond_the_blue.png';
                }}
              />
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
                  Step 2 of 2: Seat Allocation
                </span>
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                  Choose your favourite seats
                </h2>
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex-wrap">
                  <span className="font-bold text-slate-700 dark:text-slate-300">{movie?.title}</span>
                  <span>•</span>
                  <span>{cinema?.name}</span>
                  <span>•</span>
                  <span className="text-indigo-600 dark:text-indigo-400 font-bold">{showtime?.time} ({date})</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 self-start md:self-auto">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Live Lock Active</span>
              </div>
              <div className="px-3.5 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300">
                <span>Max 8 seats per order</span>
              </div>
            </div>
          </div>

          {/* Grid Layout: Seat Matrix (left 2 cols) & Order Summary (right 1 col) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
            <div className="lg:col-span-2">
              <SeatMatrix
                selectedSeats={selectedSeats}
                onToggleSeat={handleToggleSeat}
                bookedSeats={currentScreeningBookedSeats}
                userBookedSeats={myBookedSeats}
                heldSeats={activeHoldsMap}
                currentUserId={currentUser?.email}
              />
            </div>

            <div className="lg:col-span-1">
              <OrderSummary
                movie={movie}
                cinema={cinema}
                showtime={showtime}
                date={date}
                selectedSeats={selectedSeats}
                onRemoveSeat={handleRemoveSeat}
                onProceedToPayment={handleProceedToPayment}
                isProcessing={isProcessing}
              />
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: My Bookings & Pass Wallet */}
      {subTab === 'history' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                Booking History & Ticket Wallet
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                All upcoming and past verified movie passes with scannable entry QR codes.
              </p>
            </div>
          </div>

          {bookingsList.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {bookingsList.map((item) => {
                const isConfirmed = item.status === 'CONFIRMED';

                return (
                  <div
                    key={item.bookingId}
                    className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
                  >
                    <div>
                      {/* Booking Top Info */}
                      <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 text-xs">
                        <span className="font-mono font-bold text-slate-500 dark:text-slate-400">
                          {item.bookingId}
                        </span>
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          isConfirmed 
                            ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}>
                          ● {item.status}
                        </span>
                      </div>

                      {/* Movie Row */}
                      <div className="flex gap-4 py-4">
                        <img
                          src={item.movie?.poster}
                          alt={item.movie?.title}
                          className="w-16 h-22 object-cover rounded-2xl bg-slate-900 shadow-sm flex-shrink-0"
                          onError={(e) => {
                            e.target.src = '/posters/beyond_the_blue.png';
                          }}
                        />
                        <div className="space-y-1">
                          <h4 className="text-base font-bold text-slate-900 dark:text-white">
                            {item.movie?.title}
                          </h4>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {item.cinema}
                          </p>
                          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 pt-1">
                            <span className="text-indigo-600 dark:text-indigo-400 font-bold">{item.date}</span>
                            <span>•</span>
                            <span>{item.time}</span>
                          </div>
                          <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                            Seats: <span className="text-slate-900 dark:text-white font-bold">{item.seats.join(', ')}</span> ({item.tier})
                          </div>
                          {item.userName && (
                            <div className="text-[11px] text-slate-400 dark:text-slate-500 pt-0.5">
                              Booked by: <span className="font-semibold text-slate-600 dark:text-slate-300">{item.userName}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Bottom Actions & Price */}
                    <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between mt-auto">
                      <div>
                        <span className="text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-500 block">
                          Total Paid
                        </span>
                        <span className="text-sm font-extrabold text-slate-900 dark:text-emerald-400">
                          ₹{Number(item.totalAmount || 0).toFixed(2)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setViewingPass(item)}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm shadow-indigo-600/20 transition-all cursor-pointer"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                          <span>View QR Pass</span>
                        </button>

                        <button
                          onClick={() => {
                            if (window.confirm(`Cancel reservation for ${item.bookingId}?`)) {
                              onCancelBooking(item.bookingId);
                            }
                          }}
                          className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                          title="Cancel Booking"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-12 text-center space-y-3">
              <Ticket className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto" />
              <h4 className="text-base font-bold text-slate-800 dark:text-white">
                No bookings yet
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                Select a movie and complete a reservation to view your tickets here.
              </p>
              <button
                onClick={() => setSubTab('seats')}
                className="mt-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 transition-colors cursor-pointer"
              >
                Go to Seat Selection
              </button>
            </div>
          )}
        </div>
      )}

      {/* Payment Gateway Modal (UPI QR Code & Razorpay Direct Card) */}
      {paymentModalData && (
        <PaymentGatewayModal
          bookingData={paymentModalData}
          onClose={() => {
            // Release hold when user closes payment modal
            releaseSeatHold(screeningId, selectedSeats.map(s => s.code), currentUser);
            setPaymentModalData(null);
          }}
          onExpired={() => {
            // Auto release hold when 2-minute timer runs out without payment
            releaseSeatHold(screeningId, selectedSeats.map(s => s.code), currentUser);
            setPaymentModalData(null);
            setSelectedSeats([]);
            setCollisionAlert({
              title: 'Seat Hold Expired (2-Minute Window)',
              message: 'Your 2-minute payment window has expired. The held seats have been automatically released for other customers.',
              type: 'warning'
            });
          }}
          onPaymentSuccess={handlePaymentSuccess}
        />
      )}

      {/* Ticket Pass Modal upon successful booking or view request */}
      {(confirmedBooking || viewingPass) && (
        <TicketPassModal
          booking={confirmedBooking || viewingPass}
          onClose={() => {
            setConfirmedBooking(null);
            setViewingPass(null);
          }}
          onViewBookings={() => {
            setConfirmedBooking(null);
            setViewingPass(null);
            setSubTab('history');
          }}
        />
      )}
    </div>
  );
}
