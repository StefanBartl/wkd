# hover.nvim -- rest the cursor on something that points somewhere.
# Per feature: <C-t> shows the title with a 3-second countdown, then the keys;
# past the last title, <C-t> shows the "loops from here" card.
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
Sleep 300ms
Show
Sleep 3s

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
Sleep 300ms
Show
Sleep 3s

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
Sleep 300ms
Show
Sleep 3s

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
Sleep 300ms
Show
Sleep 3s

Type "/github.io"
Sleep 400ms
Enter
Sleep 800ms
Type ":Hover show"
Sleep 600ms
Enter
Sleep 5s

Hide
Ctrl+T
Sleep 200ms
Show
Sleep 2s

Hide
Type ":qa!"
Enter
