-- reserve.lua: atomic reservation of a seat (or any seat). Owned by [P1].
-- KEYS: 1 free, 2 holds, 3 owners, 4 sold, 5 rids
-- ARGV: 1 rid, 2 ttl_ms, 3 seat (empty string = any seat)

local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local function reap(free, holds, owners, rids)
  local expired = redis.call('ZRANGEBYSCORE', holds, '-inf', now)
  for _, seat in ipairs(expired) do
    local rid = redis.call('HGET', owners, seat)
    redis.call('ZREM', holds, seat)
    redis.call('HDEL', owners, seat)
    redis.call('SADD', free, seat)
    if rid then redis.call('HSET', rids, rid, 'EXPIRED|' .. seat) end
  end
end

reap(KEYS[1], KEYS[2], KEYS[3], KEYS[5])   -- (free, holds, owners, rids)
local seat = ARGV[3]
if seat == '' then
  seat = redis.call('SPOP', KEYS[1])
  if not seat then return {'SOLD_OUT'} end
else
  if redis.call('SREM', KEYS[1], seat) == 0 then
    if redis.call('HEXISTS', KEYS[4], seat) == 1 then return {'SEAT_SOLD'} end
    if redis.call('HEXISTS', KEYS[3], seat) == 1 then return {'SEAT_HELD'} end
    return {'SEAT_UNKNOWN'}
  end
end
local exp = now + tonumber(ARGV[2])
redis.call('ZADD', KEYS[2], exp, seat)
redis.call('HSET', KEYS[3], seat, ARGV[1])
redis.call('HSET', KEYS[5], ARGV[1], 'HELD|' .. seat)
return {'OK', seat, tostring(exp)}
