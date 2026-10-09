-- accept_waitlist_offer.lua: Atomically confirm a waitlist offer into a finalized booking
-- KEYS: 1 free, 2 holds, 3 owners, 4 sold, 5 rids, 6 stream (fr:bookings)
-- ARGV: 1 offer_id, 2 user_id, 3 event_id, 4 seat_id

local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local offer_id = ARGV[1]
local user_id = ARGV[2]
local event_id = ARGV[3]
local seat = ARGV[4]
local offer_rid = 'off:' .. offer_id

-- 1. Check if already confirmed (idempotent retry)
local st = redis.call('HGET', KEYS[5], offer_rid)
if st and string.match(st, '^CONFIRMED') then
  return {'ALREADY_CONFIRMED', seat}
end

-- 2. Verify offer is currently holding the seat
local owner = redis.call('HGET', KEYS[3], seat)
if owner ~= offer_rid then
  return {'OFFER_EXPIRED', seat}
end

-- 3. Verify hold has not expired
local exp = redis.call('ZSCORE', KEYS[2], seat)
if not exp or tonumber(exp) < now then
  return {'OFFER_EXPIRED', seat}
end

-- 4. Atomically convert from hold to sold
redis.call('ZREM', KEYS[2], seat)
redis.call('HDEL', KEYS[3], seat)
redis.call('HSET', KEYS[4], seat, offer_rid)
redis.call('HSET', KEYS[5], offer_rid, 'CONFIRMED|' .. seat)

-- 5. Add to stream fr:bookings for durable Postgres persistence
redis.call('XADD', KEYS[6], '*', 'event_id', event_id, 'seat_id', seat,
           'reservation_id', offer_rid, 'user_id', user_id, 'confirmed_at_ms', tostring(now))

return {'OK', seat, tostring(now)}
