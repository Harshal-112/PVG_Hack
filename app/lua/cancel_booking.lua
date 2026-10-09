-- cancel_booking.lua: Atomically cancel a confirmed booking and return seat to free
-- KEYS: 1 free, 2 holds, 3 owners, 4 sold, 5 rids
-- ARGV: 1 reservation_id

local rid = ARGV[1]
local st = redis.call('HGET', KEYS[5], rid)
if not st then
  return {'UNKNOWN'}
end

local status, seat = string.match(st, '^(%u+)|(.+)$')
if status ~= 'CONFIRMED' then
  return {'NOT_CONFIRMED', seat or ''}
end

local cur_owner = redis.call('HGET', KEYS[4], seat)
if cur_owner ~= rid then
  return {'OWNER_MISMATCH', seat or ''}
end

redis.call('HDEL', KEYS[4], seat)
redis.call('SADD', KEYS[1], seat)
redis.call('HSET', KEYS[5], rid, 'CANCELLED|' .. seat)

return {'OK', seat}
