-- Minimal, pinned Neovim config for the demo recordings (see demos/*.tape and
-- .github/workflows/demos.yml). Nothing from a personal config leaks in:
-- only lib.nvim, ui.nvim and the demoed plugin are put on the runtimepath,
-- all read from $PLUGINS_DIR (the CI checkout directory).
--
--   DEMO_PLUGIN  slug of the plugin to set up, e.g. "cascade"
--   DEMO_DEPS    comma-separated slugs to add to the rtp first (default lib,ui)
--
-- Recording aids (both from this config, not from the plugin under demo):
--   :Demo <text>   a title float in the top-right corner naming the feature
--                  currently shown; `:Demo off` removes it
--   screenkey      ui.nvim's keystroke HUD in the bottom-right corner, so the
--                  keys behind every action are visible

local root = vim.env.PLUGINS_DIR or vim.fs.normalize(vim.fn.getcwd() .. "/..")
local plugin = vim.env.DEMO_PLUGIN or ""
local deps = vim.split(vim.env.DEMO_DEPS or "lib,ui", ",", { trimempty = true })

for _, slug in ipairs(deps) do
  vim.opt.rtp:append(root .. "/" .. slug .. ".nvim")
end
if plugin ~= "" then
  vim.opt.rtp:append(root .. "/" .. plugin .. ".nvim")
end

vim.g.mapleader = " "
vim.o.number = true
vim.o.termguicolors = true
vim.o.laststatus = 2
vim.o.showmode = true
vim.o.cmdheight = 1
vim.o.signcolumn = "no"
vim.o.swapfile = false
vim.o.shortmess = vim.o.shortmess .. "I"
vim.o.fillchars = "eob: "
vim.cmd.colorscheme("habamax")

-- Per-plugin setup(); the Lua module name where it differs from the slug.
local setups = {
  cascade = { keymaps = { preset = true } },
  emojis = {},
}
local modules = { ["buffer-ctx"] = "buffer_ctx", dap = "wkddap" }

if setups[plugin] then
  local ok, err = pcall(function()
    require(modules[plugin] or plugin).setup(setups[plugin])
  end)
  if not ok then
    vim.notify("demo setup failed: " .. tostring(err), vim.log.levels.ERROR)
  end
end

-- ---- :Demo title float --------------------------------------------------------
vim.api.nvim_set_hl(0, "DemoTitle", { fg = "#1a1b26", bg = "#e0af68", bold = true })
local title = { win = nil, buf = nil }

local function title_close()
  if title.win and vim.api.nvim_win_is_valid(title.win) then
    vim.api.nvim_win_close(title.win, true)
  end
  title.win = nil
end

vim.api.nvim_create_user_command("Demo", function(o)
  title_close()
  local text = vim.trim(o.args)
  if text ~= "" and text ~= "off" then
    title.buf = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_buf_set_lines(title.buf, 0, -1, false, { " " .. text .. " " })
    title.win = vim.api.nvim_open_win(title.buf, false, {
      relative = "editor",
      anchor = "NE",
      row = 0,
      col = vim.o.columns,
      width = vim.fn.strdisplaywidth(text) + 2,
      height = 1,
      style = "minimal",
      focusable = false,
      zindex = 60,
    })
    vim.wo[title.win].winhighlight = "Normal:DemoTitle,NormalFloat:DemoTitle"
  end
  -- The typed command must not linger in the cmdline of the recording.
  vim.api.nvim_echo({}, false, {})
  vim.cmd.redraw()
end, { nargs = "*", desc = "demo title float (recording aid)" })

-- ---- screenkey HUD (ui.nvim) ----------------------------------------------------
local ok_sk, err_sk = pcall(function()
  local sk = require("ui.screenkey")
  sk.setup({ fade_ms = 1200, margin = 1, width = 34 })
  ;(sk.enable or sk.toggle)()
end)
if not ok_sk then
  vim.notify("screenkey unavailable: " .. tostring(err_sk), vim.log.levels.WARN)
end
