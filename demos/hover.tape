# hover.nvim -- rest the cursor on something that points somewhere.
# Titles via <C-t>: each one a short account of what happens, not just a name.
Source demos/_settings.tape
Output out/hover.webm
Output out/hover.mp4
Env DEMO_PLUGIN "hover"
Env DEMO_DEPS "lib,ui,markdown"
Env DEMO_TITLES ":Hover show on a markdown link -> markdown.nvim finds the target -> the file, previewed in place|:Hover show on a bare path in prose -> resolved next to the buffer -> previewed the same way|:Hover show on file.md#heading -> that section of the file, not its top|:Hover show on https://stefanbartl.github.io/wkd/ -> curl fetches the page -> status, title, first words"
Hide
Type `cd "${WKD_ROOT:-$GITHUB_WORKSPACE}" && clear && nvim -u demos/init.lua demos/fixtures/links.md`
Enter
Sleep 2s
Show
Sleep 800ms

Hide
Ctrl+T
Sleep 1500ms
Show

Type "/server.lua"
Sleep 400ms
Enter
Sleep 800ms
Type ":Hover show"
Sleep 600ms
Enter
Sleep 3500ms

Hide
Ctrl+T
Sleep 1500ms
Show

Type "/app.log"
Sleep 400ms
Enter
Sleep 800ms
Type ":Hover show"
Sleep 600ms
Enter
Sleep 3500ms

Hide
Ctrl+T
Sleep 1500ms
Show

Type "/rollback rules"
Sleep 400ms
Enter
Sleep 800ms
Type ":Hover show"
Sleep 600ms
Enter
Sleep 3500ms

Hide
Ctrl+T
Sleep 1500ms
Show

Type "/github.io"
Sleep 400ms
Enter
Sleep 800ms
Type ":Hover show"
Sleep 600ms
Enter
Sleep 5s

Hide
Type ":qa!"
Enter
