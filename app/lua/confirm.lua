-- confirm.lua: atomic confirmation of a held reservation. Owned by [P1].
-- KEYS: 1 free, 2 holds, 3 owners, 4 sold, 5 rids, 6 stream (fr:bookings)
-- ARGV: 1 rid, 2 user_id, 3 event_id

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

reap(KEYS[1], KEYS[2], KEYS[3], KEYS[5])
local st = redis.call('HGET', KEYS[5], ARGV[1])
if not st then return {'UNKNOWN'} end
local status, seat = string.match(st, '^(%u+)|(.+)$')
if status == 'CONFIRMED' then return {'ALREADY_CONFIRMED', seat} end
if status ~= 'HELD' then return {'HOLD_EXPIRED', seat} end
if redis.call('HGET', KEYS[3], seat) ~= ARGV[1] then return {'HOLD_EXPIRED', seat} end
redis.call('ZREM', KEYS[2], seat)
redis.call('HDEL', KEYS[3], seat)
redis.call('HSET', KEYS[4], seat, ARGV[1])
redis.call('HSET', KEYS[5], ARGV[1], 'CONFIRMED|' .. seat)
redis.call('XADD', KEYS[6], '*', 'event_id', ARGV[3], 'seat_id', seat,
           'reservation_id', ARGV[1], 'user_id', ARGV[2], 'confirmed_at_ms', tostring(now))
return {'OK', seat}
