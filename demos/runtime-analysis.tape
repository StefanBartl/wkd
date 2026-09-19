# runtime-analysis.nvim -- what actually ran, not what the source says.
Source demos/_settings.tape
Output out/runtime-analysis.webm
Output out/runtime-analysis.mp4
Env DEMO_PLUGIN "runtime-analysis"
Env DEMO_DEPS "lib,ui"
Hide
Type `cd "${WKD_ROOT:-$GITHUB_WORKSPACE}" && clear && nvim -u demos/init.lua demos/fixtures/server.lua`
Enter
Sleep 2s
Show
Sleep 800ms

Hide
Type ":Demo :RA inspect - a live package.loaded table, rendered"
Enter
Sleep 1500ms
Show

Type ":RA inspect lib.nvim.debounce"
Sleep 600ms
Enter
Sleep 3500ms
Type "q"
Sleep 800ms

Hide
Type ":Demo :RA usage - which commands and keys you actually use"
Enter
Sleep 1500ms
Show

Type ":RA usage start"
Sleep 500ms
Enter
Sleep 1200ms
Type ":set number?"
Sleep 300ms
Enter
Sleep 700ms
Type ":set list"
Sleep 300ms
Enter
Sleep 700ms
Type ":set nolist"
Sleep 300ms
Enter
Sleep 700ms
Type ":set number?"
Sleep 300ms
Enter
Sleep 700ms
Type ":RA usage"
Sleep 600ms
Enter
Sleep 4s

Hide
Type ":qa!"
Enter
