# color_my_ascii.nvim -- ASCII art in fenced blocks, painted.
Source demos/_settings.tape
Output out/color_my_ascii.webm
Output out/color_my_ascii.mp4
Env DEMO_PLUGIN "color_my_ascii"
Env DEMO_DEPS "lib,ui"
Hide
Type `cd "${WKD_ROOT:-$GITHUB_WORKSPACE}" && clear && nvim -u demos/init.lua demos/fixtures/diagram.md`
Enter
Sleep 2s
Type ":Demo ascii fences - box drawing, arrows, keywords highlighted on open"
Enter
Sleep 500ms
Show
Sleep 3500ms

Hide
Type ":Demo :ColorMyAscii schemes switch - matrix"
Enter
Sleep 1500ms
Show

Type ":ColorMyAscii schemes switch matrix"
Sleep 600ms
Enter
Sleep 2500ms

Hide
Type ":Demo :ColorMyAscii schemes switch - dracula"
Enter
Sleep 1500ms
Show

Type ":ColorMyAscii schemes switch dracula"
Sleep 600ms
Enter
Sleep 2500ms

Hide
Type ":Demo :ColorMyAscii hover - what paints the glyph under the cursor"
Enter
Sleep 1500ms
Show

Type "7G16|"
Sleep 800ms
Type ":ColorMyAscii hover"
Sleep 600ms
Enter
Sleep 3500ms

Hide
Type ":qa!"
Enter
