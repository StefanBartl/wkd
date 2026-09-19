# cascade.nvim -- list transforms, checkbox rotation, word cycling, continuation.
Source demos/_settings.tape
Output out/cascade.webm
Output out/cascade.mp4
Env DEMO_PLUGIN "cascade"
Env DEMO_DEPS "lib,ui"
Hide
Type `cd "${WKD_ROOT:-$GITHUB_WORKSPACE}" && clear && nvim -u demos/init.lua demos/fixtures/todo.md`
Enter
Sleep 2s
Show
Sleep 800ms

Hide
Type ":Demo :Cascade rotate - cycle the list form"
Enter
Sleep 1500ms
Show

# the cursor has to be on the list block
Type "3G"
Sleep 600ms
Type ":Cascade rotate"
Sleep 600ms
Enter
Sleep 1500ms
Type ":Cascade rotate"
Enter
Sleep 1500ms

Hide
Type ":Demo <C-y> and + cycle words and numbers"
Enter
Sleep 1500ms
Show

Type "/true"
Enter
Sleep 800ms
Ctrl+Y
Sleep 900ms
Ctrl+Y
Sleep 900ms
Type "j"
Type "$"
Sleep 400ms
Type "+"
Sleep 600ms
Type "+"
Sleep 900ms

Hide
Type ":Demo o and Enter continue the list"
Enter
Sleep 1500ms
Show

Type "4G"
Sleep 500ms
Type "o"
Sleep 300ms
Type "record the tape"
Sleep 400ms
Enter
Type "publish the site"
Sleep 600ms
Escape
Sleep 1200ms

Hide
Type ":Demo :Cascade sort"
Enter
Sleep 1500ms
Show

Type ":Cascade sort"
Sleep 400ms
Enter
Sleep 2500ms

Hide
Type ":q!"
Enter
