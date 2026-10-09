-- Shared reap snippet for expiring holds. Owned by [P1].
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
