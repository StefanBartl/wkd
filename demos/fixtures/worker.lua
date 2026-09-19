local M = {}

-- TODO: batch the queries instead of one round trip per id
local function fetch_user(id)
  return db.query("select * from users where id = ?", id)
end

-- FIXME: avatar_url can be nil for imported accounts
function M.avatar(id)
  local user = fetch_user(id)
  return user and user.avatar_url or nil
end

-- HACK: retries are hard-coded until the config schema lands
function M.profile(id)
  for _ = 1, 3 do
    local user = fetch_user(id)
    if user then
      return { name = user.name, mail = user.mail }
    end
  end
  return nil, "no such user"
end

return M
