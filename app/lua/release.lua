-- release.lua: atomic release of a held reservation. Owned by [P1].
-- KEYS: 1 free, 2 holds, 3 owners, 4 sold, 5 rids
-- ARGV: 1 rid

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
if status ~= 'HELD' then return {'NOOP', seat} end
redis.call('ZREM', KEYS[2], seat)
redis.call('HDEL', KEYS[3], seat)
redis.call('SADD', KEYS[1], seat)
redis.call('HSET', KEYS[5], ARGV[1], 'RELEASED|' .. seat)
return {'OK', seat}
