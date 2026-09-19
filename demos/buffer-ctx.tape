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

Hide
Type ":Demo :Insert location - path:line, at the cursor"
Enter
Sleep 1500ms
Show

Type "2G"
Sleep 300ms
Type "o"
Sleep 200ms
Type "-- "
Sleep 200ms
Escape
Sleep 400ms
Type ":Insert location"
Sleep 600ms
Enter
Sleep 2200ms

Hide
Type ":Demo :Insert timestamp - and date, uuid, env, linecount ..."
Enter
Sleep 1500ms
Show

Type "o"
Sleep 200ms
Type "-- reviewed "
Sleep 200ms
Escape
Sleep 400ms
Type ":Insert timestamp"
Sleep 600ms
Enter
Sleep 2200ms

Hide
Type ":Demo :Insert uuid - a v4 uuid where you type"
Enter
Sleep 1500ms
Show

Type "o"
Sleep 200ms
Type "-- trace "
Sleep 200ms
Escape
Sleep 400ms
Type ":Insert uuid"
Sleep 600ms
Enter
Sleep 2200ms

Hide
Type ":Demo :Insert git short - the revision this buffer belongs to"
Enter
Sleep 1500ms
Show

Type "o"
Sleep 200ms
Type "-- built from "
Sleep 200ms
Escape
Sleep 400ms
Type ":Insert git short"
Sleep 600ms
Enter
Sleep 3s

Hide
Type ":qa!"
Enter
