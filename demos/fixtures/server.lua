local M = {}

local function fetch_user(id)
  return db.query("select * from users where id = ?", id)
end

function M.profile(id)
  local user = fetch_user(id)
  if not user then
    return nil, "no such user"
  end
  return { name = user.name, mail = user.mail }
end

function M.avatar(id)
  local user = fetch_user(id)
  return user and user.avatar_url or nil
end

return M
