# cmdlog.nvim -- your command-line history, searched and reused, never run for you.
Source demos/_settings.tape
Output out/cmdlog.webm
Output out/cmdlog.mp4
Env DEMO_PLUGIN "cmdlog"
Env DEMO_DEPS "lib,ui,nvim-lua/plenary.nvim,nvim-telescope/telescope.nvim"
Hide
Type `cd "${WKD_ROOT:-$GITHUB_WORKSPACE}" && clear && nvim -u demos/init.lua demos/fixtures/server.lua`
Enter
Sleep 2s
Type ":set list"
Enter
Type ":set nolist"
Enter
Type ":%s/fetch_user/load_user/gc"
Enter
Type "q"
Type ":g/^function/p"
Enter
Type ":split demos/fixtures/todo.md"
Enter
Type ":close"
Enter
Sleep 500ms
Show
Sleep 800ms

Hide
Type ":Demo :Cmdlog - the : history as a picker; Enter puts it back on the command line"
Enter
Sleep 1500ms
Show

Type ":Cmdlog"
Sleep 600ms
Enter
Sleep 2500ms
Type "fun"
Sleep 2s
Enter
Sleep 2500ms
Escape
Sleep 800ms

Hide
Type ":Demo :Cmdlog stats - what you type most"
Enter
Sleep 1500ms
Show

Type ":Cmdlog stats"
Sleep 600ms
Enter
Sleep 3500ms

Hide
Type ":qa!"
Enter
