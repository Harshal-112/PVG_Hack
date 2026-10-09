-- release_waitlist_offer.lua: Atomically release a declined or expired waitlist offer
-- KEYS: 1 free, 2 holds, 3 owners, 4 sold, 5 rids
-- ARGV: 1 offer_id, 2 seat_id, 3 new_status

local offer_id = ARGV[1]
local seat = ARGV[2]
local new_status = ARGV[3] or 'DECLINED'
local offer_rid = 'off:' .. offer_id

local owner = redis.call('HGET', KEYS[3], seat)
if owner == offer_rid then
  redis.call('ZREM', KEYS[2], seat)
  redis.call('HDEL', KEYS[3], seat)
  redis.call('SADD', KEYS[1], seat)
  redis.call('HSET', KEYS[5], offer_rid, new_status .. '|' .. seat)
  return {'OK', seat}
end

return {'NOOP', seat}
