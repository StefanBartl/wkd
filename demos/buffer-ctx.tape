# buffer-ctx.nvim -- what the buffer knows about itself, inserted as text.
Source demos/_settings.tape
Output out/buffer-ctx.webm
Output out/buffer-ctx.mp4
Env DEMO_PLUGIN "buffer-ctx"
Env DEMO_DEPS "lib,ui"
Hide
Type `cd "${WKD_ROOT:-$GITHUB_WORKSPACE}" && clear && nvim -u demos/init.lua demos/fixtures/worker.lua`
Enter
Sleep 2s
Show
Sleep 800ms
Type "2G"
Sleep 400ms

Hide
Type ":Demo :Insert location - path:line, at the cursor"
Enter
Sleep 1500ms
Show

Type "o"
Sleep 200ms
Escape
Sleep 300ms
Type ":Insert location"
Sleep 600ms
Enter
Sleep 1200ms
Type "I-- see "
Sleep 300ms
Escape
Sleep 1800ms

Hide
Type ":Demo :Insert timestamp - and date, env, uuid, linecount ..."
Enter
Sleep 1500ms
Show

Type "o"
Sleep 200ms
Escape
Sleep 300ms
Type ":Insert timestamp"
Sleep 600ms
Enter
Sleep 1200ms
Type "I-- reviewed "
Sleep 300ms
Escape
Sleep 1800ms

Hide
Type ":Demo :Insert uuid - a v4 uuid where you type"
Enter
Sleep 1500ms
Show

Type "o"
Sleep 200ms
Escape
Sleep 300ms
Type ":Insert uuid"
Sleep 600ms
Enter
Sleep 1200ms
Type "I-- trace "
Sleep 300ms
Escape
Sleep 1800ms

Hide
Type ":Demo :Insert linecount - and filename, filepath, module ..."
Enter
Sleep 1500ms
Show

Type "o"
Sleep 200ms
Escape
Sleep 300ms
Type ":Insert linecount"
Sleep 600ms
Enter
Sleep 1200ms
Type "I-- lines: "
Sleep 300ms
Escape
Sleep 1800ms

Hide
Type ":qa!"
Enter
