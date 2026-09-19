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
-- Diff colours that read on a recording (habamax keeps them faint).
vim.api.nvim_set_hl(0, "DiffAdd", { bg = "#2a3d2f" })
vim.api.nvim_set_hl(0, "DiffDelete", { bg = "#3d2a2e", fg = "#5a4a4e" })
vim.api.nvim_set_hl(0, "DiffChange", { bg = "#33303a" })
vim.api.nvim_set_hl(0, "DiffText", { bg = "#4a4530", bold = true })

-- Per-plugin setup(); the Lua module name where it differs from the slug.
local setups = {
  cascade = { keymaps = { preset = true } },
  emojis = {},
  replacer = {},
  spotlight = {},
  data = {},
  diff = {},
  markdown = {},
  color_my_ascii = {},
  hover = {},
  insights = {},
}
local modules = { ["buffer-ctx"] = "buffer_ctx", dap = "wkddap" }
-- Per-plugin editor tweaks for the recording.
local tweaks = {
  -- data.nvim rewrites through a substitute; its search register would light
  -- up every key in the result.
  -- After `lines` / `to yaml` the buffer still has filetype json, whose
  -- syntax file paints unquoted keys as errors.
  data = function()
    vim.o.hlsearch = false
    vim.g.vim_json_warnings = 0
  end,
}
if tweaks[plugin] then tweaks[plugin]() end

-- Dependencies that must be set up as well for the demoed feature to exist
-- (hover.nvim's link scanner is contributed by markdown.nvim's setup()).
local also = { hover = { "markdown" } }

local function setup_plugin(slug)
  if not setups[slug] then
    return
  end
  local ok, err = pcall(function()
    local m = require(modules[slug] or slug)
    if type(m.setup) == "function" then
      m.setup(setups[slug])
    end
  end)
  if not ok then
    vim.notify("demo setup failed for " .. slug .. ": " .. tostring(err), vim.log.levels.ERROR)
  end
end
for _, slug in ipairs(also[plugin] or {}) do
  setup_plugin(slug)
end
setup_plugin(plugin)

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

-- ---- :DemoDump (recording diagnostics) ---------------------------------------
-- Appends the window/option state to demos/out/_dump-<plugin>.txt; the Record
-- workflow prints those files into the job log and drops them before
-- publishing. Hidden in a tape (`Hide` / `Show`), it is how a recording that
-- looks wrong in CI but right locally gets explained.
vim.api.nvim_create_user_command("DemoDump", function(o)
  local api = vim.api
  local out = { ("== %s  nvim %s  %dx%d  diffopt=%s"):format(
    o.args ~= "" and o.args or "dump", tostring(vim.version()), vim.o.columns, vim.o.lines, vim.o.diffopt) }
  local cur = api.nvim_get_current_win()
  for _, w in ipairs(api.nvim_list_wins()) do
    local b = api.nvim_win_get_buf(w)
    local cfg = api.nvim_win_get_config(w)
    local ok, err = pcall(api.nvim_set_option_value, "diff", vim.wo[w].diff, { win = w, scope = "local" })
    out[#out + 1] = ("win=%d%s rel=%q diff=%s number=%s bt=%q buf=%q cursor=%d,%d set_diff=%s"):format(
      w, w == cur and "*" or "", cfg.relative or "", tostring(vim.wo[w].diff), tostring(vim.wo[w].number),
      vim.bo[b].buftype, vim.fn.fnamemodify(api.nvim_buf_get_name(b), ":t"),
      api.nvim_win_get_cursor(w)[1], api.nvim_win_get_cursor(w)[2], ok and "ok" or tostring(err))
  end
  for line in vim.fn.execute("messages"):gmatch("[^\n]+") do
    out[#out + 1] = "msg: " .. line
  end
  vim.fn.mkdir("demos/out", "p")
  vim.fn.writefile(out, ("demos/out/_dump-%s.txt"):format(plugin ~= "" and plugin or "nvim"), "a")
  api.nvim_echo({}, false, {})
  vim.cmd.redraw()
end, { nargs = "?", desc = "append window state to demos/out/_dump-<plugin>.txt (recording aid)" })
