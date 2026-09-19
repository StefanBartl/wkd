# cascade.nvim -- list transforms, checkbox rotation, word cycling, continuation.
Source demos/_settings.tape
Output out/cascade.webm
Output out/cascade.mp4
Env DEMO_PLUGIN "cascade"
Env DEMO_DEPS "lib,ui"

Hide
Type "cd \"${WKD_ROOT:-$GITHUB_WORKSPACE}\" && clear && nvim -u demos/init.lua demos/fixtures/todo.md"
Enter
Sleep 2s
Show
Sleep 1s

# rotate the numbered list through its forms: 1. -> 1. [ ] -> - [ ]
Type ":Cascade rotate"
Sleep 600ms
Enter
Sleep 1500ms
Type ":Cascade rotate"
Enter
Sleep 1500ms

# cycle words: true -> false, 3 -> 4 (<C-y> / +)
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

# list continuation: `o` opens the next item, Enter continues, Enter on an
# empty item ends the list
Type "gg"
Type "3j"
Sleep 500ms
Type "o"
Sleep 300ms
Type "record the tape"
Sleep 400ms
Enter
Type "publish the site"
Sleep 400ms
Enter
Sleep 600ms
Enter
Escape
Sleep 1200ms

# sort the block
Type ":Cascade sort"
Enter
Sleep 2500ms

Hide
Type ":q!"
Enter
