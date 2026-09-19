# hover.nvim -- rest the cursor on something that points at a file.
Source demos/_settings.tape
Output out/hover.webm
Output out/hover.mp4
Env DEMO_PLUGIN "hover"
Env DEMO_DEPS "lib,ui,markdown"
Hide
Type `cd "${WKD_ROOT:-$GITHUB_WORKSPACE}" && clear && nvim -u demos/init.lua demos/fixtures/links.md`
Enter
Sleep 2s
Show
Sleep 800ms

Hide
Type ":Demo :Hover show - a markdown link, previewed in place"
Enter
Sleep 1500ms
Show

Type "/server.lua"
Sleep 400ms
Enter
Sleep 800ms
Type ":Hover show"
Sleep 600ms
Enter
Sleep 3s

Hide
Type ":Demo :Hover show - a bare path in prose"
Enter
Sleep 1500ms
Show

Type "/app.log"
Sleep 400ms
Enter
Sleep 800ms
Type ":Hover show"
Sleep 600ms
Enter
Sleep 3s

Hide
Type ":Demo :Hover show - file.md#heading opens on that section"
Enter
Sleep 1500ms
Show

Type "/rollback rules"
Sleep 400ms
Enter
Sleep 800ms
Type ":Hover show"
Sleep 600ms
Enter
Sleep 3s

Hide
Type ":Demo :Hover why - which gate refused, and what to type about it"
Enter
Sleep 1500ms
Show

Type "/team channel"
Sleep 400ms
Enter
Sleep 800ms
Type ":Hover why"
Sleep 600ms
Enter
Sleep 3500ms

Hide
Type ":qa!"
Enter
