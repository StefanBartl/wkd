# pickers.nvim -- one :Pickers command over telescope, fzf-lua or snacks.
Source demos/_settings.tape
Output out/pickers.webm
Output out/pickers.mp4
Env DEMO_PLUGIN "pickers"
Env DEMO_DEPS "lib,ui,nvim-lua/plenary.nvim,nvim-telescope/telescope.nvim"
Hide
Type `cd "${WKD_ROOT:-$GITHUB_WORKSPACE}/demos/fixtures" && clear && nvim -u ../init.lua server.lua`
Enter
Sleep 2s
Show
Sleep 800ms

Hide
Type ":Demo :Pickers cwd files - files under the working directory"
Enter
Sleep 1500ms
Show

Type ":Pickers cwd files"
Sleep 600ms
Enter
Sleep 2s
Type "todo"
Sleep 1500ms
Enter
Sleep 2500ms

Hide
Type ":Demo :Pickers cwd grep - live grep, same scope, same command"
Enter
Sleep 1500ms
Show

Type ":Pickers cwd grep"
Sleep 600ms
Enter
Sleep 1500ms
Type "retry"
Sleep 2500ms
Escape
Sleep 1200ms

Hide
Type ":qa!"
Enter
