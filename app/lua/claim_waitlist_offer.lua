-- claim_waitlist_offer.lua: Atomically claim a free or released seat for a waitlist offer
-- KEYS: 1 free, 2 holds, 3 owners, 4 sold, 5 rids
-- ARGV: 1 seat_id, 2 offer_id, 3 expires_at_ms

local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local seat = ARGV[1]
local offer_id = ARGV[2]
local exp = tonumber(ARGV[3])
local offer_rid = 'off:' .. offer_id

-- 1. Check if seat is sold
if redis.call('HEXISTS', KEYS[4], seat) == 1 then
  return {'SEAT_SOLD'}
end

-- 2. Check if seat is currently held by someone else
if redis.call('HEXISTS', KEYS[3], seat) == 1 then
  local cur_owner = redis.call('HGET', KEYS[3], seat)
  if cur_owner ~= offer_rid then
    return {'SEAT_HELD'}
  end
end

-- 3. Claim seat from free set
redis.call('SREM', KEYS[1], seat)

-- 4. Set hold with offer expiry
redis.call('ZADD', KEYS[2], exp, seat)
redis.call('HSET', KEYS[3], seat, offer_rid)
redis.call('HSET', KEYS[5], offer_rid, 'OFFERED|' .. seat)

return {'OK', seat, tostring(exp)}
