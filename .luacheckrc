-- demos/init.lua is Neovim Lua; checked with the same std and globals as the
-- plugins it drives (lib.nvim's .luacheckrc, reduced to what one config file
-- needs), so that `luacheck demos/init.lua` from this directory is meaningful.
std = "luajit"
globals = { "vim" }
