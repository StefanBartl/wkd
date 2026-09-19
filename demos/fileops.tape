# fileops.nvim -- one :File command, all operations, buffer and disk in agreement.
Source demos/_settings.tape
Output out/fileops.webm
Output out/fileops.mp4
Env DEMO_PLUGIN "fileops"
Env DEMO_DEPS "lib,ui"
Hide
# A throwaway copy of two fixtures, so the recording can rename and duplicate.
Type `R="${WKD_ROOT:-$GITHUB_WORKSPACE}"; rm -rf /tmp/fdemo && mkdir -p /tmp/fdemo && cp "$R/demos/fixtures/server.lua" "$R/demos/fixtures/config.json" /tmp/fdemo/ && cd /tmp/fdemo && clear && nvim -u "$R/demos/init.lua" server.lua`
Enter
Sleep 2s
Show
Sleep 800ms

Hide
Type ":Demo :File duplicate - copy the file, open the copy"
Enter
Sleep 1500ms
Show

Type ":File duplicate server_v2.lua"
Sleep 600ms
Enter
Sleep 2500ms

Hide
Type ":Demo :File rename - on disk and in the buffer"
Enter
Sleep 1500ms
Show

Type ":File rename profile.lua"
Sleep 600ms
Enter
Sleep 2500ms

Hide
Type ":Demo :File next - cycle through the files in the directory"
Enter
Sleep 1500ms
Show

Type ":File next"
Sleep 500ms
Enter
Sleep 1500ms
Type ":File next"
Sleep 500ms
Enter
Sleep 1500ms
Type ":File next"
Sleep 500ms
Enter
Sleep 1500ms

Hide
Type ":Demo :File path rel - the path, copied"
Enter
Sleep 1500ms
Show

Type ":File path rel"
Sleep 600ms
Enter
Sleep 2500ms

Hide
Type ":qa!"
Enter
