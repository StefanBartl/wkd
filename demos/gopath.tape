# gopath.nvim -- a path in text, resolved and opened.
Source demos/_settings.tape
Output out/gopath.webm
Output out/gopath.mp4
Env DEMO_PLUGIN "gopath"
Env DEMO_DEPS "lib,ui"
Hide
Type `cd "${WKD_ROOT:-$GITHUB_WORKSPACE}" && clear && nvim -u demos/init.lua demos/fixtures/paths.md`
Enter
Sleep 2s
Show
Sleep 800ms

Hide
Type ":Demo gP - open path:line:col under the cursor, right there"
Enter
Sleep 1500ms
Show

Type "/server.lua"
Sleep 400ms
Enter
Sleep 800ms
Type "gP"
Sleep 3s

Hide
Type ":Demo g\ - the same, in a vertical split"
Enter
Sleep 1500ms
Show

Type ":edit demos/fixtures/paths.md"
Sleep 400ms
Enter
Sleep 800ms
Type "/config.json"
Sleep 400ms
Enter
Sleep 800ms
Type `g\`
Sleep 3s

Hide
Type ":Demo g? - the resolution chain, when a jump goes somewhere odd"
Enter
Sleep 1500ms
Show

Type ":only"
Sleep 300ms
Enter
Sleep 500ms
Type ":edit demos/fixtures/paths.md"
Sleep 400ms
Enter
Sleep 800ms
Type "/app.log"
Sleep 400ms
Enter
Sleep 800ms
Type "g?"
Sleep 4s

Hide
Type ":qa!"
Enter
