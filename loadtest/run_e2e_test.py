import sys
sys.path.insert(0, '.')
import httpx

BASE = 'http://127.0.0.1:8000'

def check(name, cond, details=''):
    if cond:
        print(f'[PASS] {name}: {details}')
    else:
        print(f'[FAIL] {name}: {details}')
        sys.exit(1)

with httpx.Client(timeout=10.0) as client:
    # 1. UI static assets
    for asset in [
        '/ui/index.html',
        '/ui/events.html',
        '/ui/ticket.html',
        '/ui/dashboard.html',
        '/ui/style.css',
        '/ui/app.js',
        '/ui/upi_qr.png',
        '/ui/qrcode.min.js'
    ]:
        r = client.get(f'{BASE}{asset}')
        check(f'Asset {asset}', r.status_code == 200, f'status={r.status_code}, bytes={len(r.content)}')

    # 2. Events list
    r_events = client.get(f'{BASE}/api/v1/events')
    events = r_events.json().get('events', [])
    check('Events Catalog', r_events.status_code == 200 and len(events) == 3, f'total={len(events)}')

    # 3. Waiting Room status & stats
    r_wr_stat = client.get(f'{BASE}/api/v1/events/evt1/waiting-room/status?user_id=u_test_live')
    check('Waiting room status', r_wr_stat.status_code == 200, str(r_wr_stat.json()))
    r_wr_stats = client.get(f'{BASE}/api/v1/events/evt1/waiting-room/stats')
    check('Waiting room stats', r_wr_stats.status_code == 200, str(r_wr_stats.json()))

    # 4. Seat reservation (pick any currently available free seat)
    r_seats_init = client.get(f'{BASE}/api/v1/events/evt1/seats')
    all_seats = r_seats_init.json().get('seats', {})
    target_seat = next((s for s, state in all_seats.items() if state == 'FREE'), 'S050')

    r_res = client.post(f'{BASE}/api/v1/events/evt1/reserve', json={'user_id': 'u_live_test_user', 'seat_id': target_seat})
    check(f'Reserve seat {target_seat}', r_res.status_code == 201, str(r_res.json()))
    rid = r_res.json()['reservation_id']

    # 5. Razorpay order creation
    r_order = client.post(f'{BASE}/api/v1/payments/order', json={
        'event_id': 'evt1',
        'reservation_id': rid,
        'user_id': 'u_live_test_user'
    })
    check('Create payment order', r_order.status_code == 201, str(r_order.json()))
    order_data = r_order.json()
    order_id = order_data['razorpay_order_id']

    # 6. Payment verification
    import hmac, hashlib
    from app.config import settings
    # Compute authentic razorpay signature
    raw_sig = f'{order_id}|pay_live_test_123'.encode('utf-8')
    sig = hmac.new(settings.RAZORPAY_KEY_SECRET.encode('utf-8'), raw_sig, hashlib.sha256).hexdigest()

    r_verify = client.post(f'{BASE}/api/v1/payments/verify', json={
        'event_id': 'evt1',
        'reservation_id': rid,
        'user_id': 'u_live_test_user',
        'razorpay_order_id': order_id,
        'razorpay_payment_id': 'pay_live_test_123',
        'razorpay_signature': sig
    })
    check('Verify payment & confirm booking', r_verify.status_code == 200, str(r_verify.json()))

    # 7. Ticket verification
    r_tkt = client.get(f'{BASE}/api/v1/events/evt1/tickets/{rid}/verify')
    check('Ticket verification', r_tkt.status_code == 200 and r_tkt.json().get('valid') is True, str(r_tkt.json()))

    # 8. Seat sold confirmation
    r_seats = client.get(f'{BASE}/api/v1/events/evt1/seats')
    seats_map = r_seats.json().get('seats', {})
    check(f'Seat {target_seat} sold status', seats_map.get(target_seat) == 'SOLD', f'state={seats_map.get(target_seat)}')

    # 9. Admin telemetry stats
    r_admin = client.get(f'{BASE}/api/v1/events/evt1/stats')
    check('Admin stats', r_admin.status_code == 200, str(r_admin.json()))

    print('\n==========================================================')
    print('ALL LIVE SERVER END-TO-END TESTS PASSED 100% SUCCESSFULLY!')
    print('==========================================================')
