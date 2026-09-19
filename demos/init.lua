-- Minimal, pinned Neovim config for the demo recordings (see demos/*.tape and
-- .github/workflows/demos.yml). Nothing from a personal config leaks in:
-- only lib.nvim, ui.nvim and the demoed plugin are put on the runtimepath,
-- all read from $PLUGINS_DIR (the CI checkout directory).
--
--   DEMO_PLUGIN  slug of the plugin to set up, e.g. "cascade"
--   DEMO_DEPS    comma-separated slugs to add to the rtp first (default lib,ui)

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
