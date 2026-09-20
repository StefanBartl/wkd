# cmdlog.nvim -- your command-line history, searched and reused, never run for you.
Source demos/_settings.tape
Output out/cmdlog.webm
Output out/cmdlog.mp4
Env DEMO_PLUGIN "cmdlog"
Env DEMO_DEPS "lib,ui,nvim-lua/plenary.nvim,nvim-telescope/telescope.nvim"
# Titles via <C-t>: a typed :Demo would be recorded as a command of its own.
# <C-t> counts down 3 seconds before the feature's keys (demos/init.lua): the
# keys come after that countdown, not under it.
Env DEMO_TITLES ":Cmdlog - the : history as a picker; Enter puts it back on the command line|:Cmdlog stats - what you type most"
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
Ctrl+T
Sleep 300ms
Show
Sleep 3s

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
Ctrl+T
Sleep 300ms
Show
Sleep 3s

Type ":Cmdlog stats"
Sleep 600ms
Enter
Sleep 3500ms

Hide
Type ":qa!"
Enter
