-- Minimal, pinned Neovim config for the demo recordings (see demos/*.tape and
-- .github/workflows/demos.yml). Nothing from a personal config leaks in:
-- only lib.nvim, ui.nvim and the demoed plugin are put on the runtimepath,
-- all read from $PLUGINS_DIR (the CI checkout directory).
--
--   DEMO_PLUGIN  slug of the plugin to set up, e.g. "cascade"
--   DEMO_DEPS    comma-separated slugs (or owner/repo for third-party
--                checkouts) to add to the rtp first (default lib,ui)
--
-- Recording aids (both from this config, not from the plugin under demo):
--   :Demo <text>   a title float in the top-right corner naming the feature
--                  currently shown; `:Demo off` removes it. <C-t> shows the
--                  next one from $DEMO_TITLES instead of typing a command.
--   screenkey      ui.nvim's keystroke HUD in the bottom-right corner, so the
--                  keys behind every action are visible

local root = vim.env.PLUGINS_DIR or vim.fs.normalize(vim.fn.getcwd() .. "/..")
local plugin = vim.env.DEMO_PLUGIN or ""
local deps = vim.split(vim.env.DEMO_DEPS or "lib,ui", ",", { trimempty = true })

for _, dep in ipairs(deps) do
  -- A bare slug is one of the family (<slug>.nvim); "owner/repo@sha" is a
  -- third-party dependency checked out under its own repository name.
  local dir = dep:find("/", 1, true) and dep:match("([^/@]+)@?[^/]*$") or (dep .. ".nvim")
  vim.opt.rtp:append(root .. "/" .. dir)
end
if plugin ~= "" then
  vim.opt.rtp:append(root .. "/" .. plugin .. ".nvim")
end

vim.g.mapleader = " "
-- lib.nvim pops a first-run panel listing a plugin's missing external tools
-- (curl, for diff.nvim's URL sources) -- and enters it. In the recording
-- container that float would become the window the demoed command runs
-- from. Tools a demo really needs are mounted by the workflow instead.
vim.g.lib_nvim_deps_disable_first_run = true
-- No clipboard tool in the container: a no-op provider keeps "clipboard: No
-- provider" out of the cmdline when a plugin also yanks to "+.
vim.g.clipboard = {
  name = "demo-noop",
  copy = { ["+"] = function() end, ["*"] = function() end },
  paste = { ["+"] = function() return {} end, ["*"] = function() return {} end },
}
vim.o.number = true
vim.o.termguicolors = true
vim.o.laststatus = 2
vim.o.showmode = true
vim.o.cmdheight = 1
vim.o.signcolumn = "no"
vim.o.swapfile = false
vim.o.shortmess = vim.o.shortmess .. "I"
vim.o.fillchars = "eob: "
-- tokyonight-night when its checkout is there (demos.json "always"), the same
-- family the terminal theme in demos/_settings.tape comes from; habamax
-- otherwise, with a border colour that does not vanish into the float.
if vim.uv.fs_stat(root .. "/tokyonight.nvim") then
  vim.opt.rtp:append(root .. "/tokyonight.nvim")
  vim.cmd.colorscheme("tokyonight-night")
else
  vim.cmd.colorscheme("habamax")
  vim.api.nvim_set_hl(0, "FloatBorder", { fg = "#7aa2f7", bg = "#2c2c2c" })
  -- Diff colours that read on a recording (habamax keeps them faint).
  vim.api.nvim_set_hl(0, "DiffAdd", { bg = "#2a3d2f" })
  vim.api.nvim_set_hl(0, "DiffDelete", { bg = "#3d2a2e", fg = "#5a4a4e" })
  vim.api.nvim_set_hl(0, "DiffChange", { bg = "#33303a" })
  vim.api.nvim_set_hl(0, "DiffText", { bg = "#4a4530", bold = true })
end

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
  -- URL hovers on: the recording fetches the family site itself (curl is
  -- mounted into the container).
  hover = { links = { web = true, fetch = true }, inline_images = false },
  media = {},
  pdfport = {},
  insights = {},
  fileops = {},
  ["buffer-ctx"] = {},
  recommender = {},
  sessions = { branch_aware = false, autosave = false },
  ui = { usrcmds = true, notify = true },
  gopath = {},
  ["runtime-analysis"] = {},
  documentation = {},
  pickers = {},
  cmdlog = {},
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
  -- `o` on a comment line would auto-insert a second `--` before the typed one.
  ["buffer-ctx"] = function()
    vim.api.nvim_create_autocmd("FileType", {
      pattern = "lua",
      callback = function()
        vim.opt_local.formatoptions:remove({ "o", "r" })
      end,
    })
  end,
}
if tweaks[plugin] then tweaks[plugin]() end

-- Dependencies that must be set up as well for the demoed feature to exist
-- (hover.nvim's link scanner is contributed by markdown.nvim's setup()).
local also = { hover = { "markdown", "media", "pdfport" } }

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
  -- Only when this tape put it on the runtimepath: hover's plain tape runs
  -- without media/pdfport, its media tape with them.
  if vim.tbl_contains(deps, slug) then
    setup_plugin(slug)
  end
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
    -- Wrap at word boundaries so a title that tells the whole story ("-> ...
    -- -> ...") stays on screen instead of running off the right edge.
    local max_w = math.max(20, vim.o.columns - 6)
    local lines, cur = {}, ""
    for word in text:gmatch("%S+") do
      local joined = cur == "" and word or (cur .. " " .. word)
      if vim.fn.strdisplaywidth(joined) > max_w and cur ~= "" then
        lines[#lines + 1] = cur
        cur = word
      else
        cur = joined
      end
    end
    lines[#lines + 1] = cur
    local width = 0
    for i, l in ipairs(lines) do
      width = math.max(width, vim.fn.strdisplaywidth(l))
      lines[i] = " " .. l .. " "
    end
    title.buf = vim.api.nvim_create_buf(false, true)
    vim.bo[title.buf].bufhidden = "wipe"
    vim.api.nvim_buf_set_lines(title.buf, 0, -1, false, lines)
    title.win = vim.api.nvim_open_win(title.buf, false, {
      relative = "editor",
      anchor = "NE",
      row = 0,
      col = vim.o.columns,
      width = width + 2,
      height = #lines,
      style = "minimal",
      focusable = false,
      zindex = 60,
    })
    vim.wo[title.win].winhighlight = "Normal:DemoTitle,NormalFloat:DemoTitle"
  end
  -- The typed command must not linger in the cmdline of the recording, nor
  -- in the : history (cmdlog.nvim's demo lists that history). Only when it
  -- was typed: from the <C-t> map the last entry is somebody else's.
  if vim.fn.histget("cmd", -1):match("^Demo%f[%s]") then
    vim.fn.histdel("cmd", -1)
  end
  vim.api.nvim_echo({}, false, {})
  vim.cmd.redraw()
end, { nargs = "*", desc = "demo title float (recording aid)" })

-- <C-t> shows the next title from $DEMO_TITLES ("first|second|..."), for a
-- tape whose plugin records every typed : command (cmdlog.nvim), where a
-- typed :Demo would show up in the demo itself.
local titles = vim.split(vim.env.DEMO_TITLES or "", "|", { trimempty = true })
local title_i = 0
vim.keymap.set("n", "<C-t>", function()
  title_i = title_i + 1
  vim.cmd.Demo(titles[title_i] or "off")
end, { desc = "next demo title from $DEMO_TITLES (recording aid)" })

-- ---- screenkey HUD (ui.nvim) ----------------------------------------------------
local ok_sk, err_sk = pcall(function()
  local sk = require("ui.screenkey")
  sk.setup({
    fade_ms = 1200,
    margin = 1,
    width = 34,
    -- Typed text reads as text ("todo-done.md" + one return glyph) instead
    -- of one chip per key; <Esc> and <C-…> keep their bracketed form.
    join_chars = true,
    labels = { ["<Space>"] = "\xE2\x90\xA3", ["<CR>"] = "\xE2\x8F\x8E", ["<BS>"] = "\xE2\x8C\xAB" },
  })
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
    local first = (api.nvim_buf_get_lines(b, 0, 1, false)[1] or ""):sub(1, 40)
    local title = type(cfg.title) == "table" and cfg.title[1] and tostring(cfg.title[1][1]) or ""
    out[#out + 1] = ("win=%d%s rel=%q diff=%s number=%s bt=%q buf=%q title=%q first=%q cursor=%d,%d set_diff=%s"):format(
      w, w == cur and "*" or "", cfg.relative or "", tostring(vim.wo[w].diff), tostring(vim.wo[w].number),
      vim.bo[b].buftype, vim.fn.fnamemodify(api.nvim_buf_get_name(b), ":t"), title, first,
      api.nvim_win_get_cursor(w)[1], api.nvim_win_get_cursor(w)[2], ok and "ok" or tostring(err))
  end
  for line in vim.fn.execute("messages"):gmatch("[^\n]+") do
    out[#out + 1] = "msg: " .. line
  end
  -- Next to this file, not relative to the cwd: a tape may cd elsewhere.
  local dir = vim.fs.dirname(vim.fs.normalize(debug.getinfo(1, "S").source:sub(2))) .. "/out"
  vim.fn.mkdir(dir, "p")
  vim.fn.writefile(out, ("%s/_dump-%s.txt"):format(dir, plugin ~= "" and plugin or "nvim"), "a")
  if vim.fn.histget("cmd", -1):match("^DemoDump") then
    vim.fn.histdel("cmd", -1)
  end
  api.nvim_echo({}, false, {})
  vim.cmd.redraw()
end, { nargs = "?", desc = "append window state to demos/out/_dump-<plugin>.txt (recording aid)" })
