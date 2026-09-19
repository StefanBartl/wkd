# sessions.nvim -- project-aware sessions on Neovim's own :mksession.
Source demos/_settings.tape
Output out/sessions.webm
Output out/sessions.mp4
Env DEMO_PLUGIN "sessions"
Env DEMO_DEPS "lib,ui"
Hide
Type `cd "${WKD_ROOT:-$GITHUB_WORKSPACE}" && clear && nvim -u demos/init.lua demos/fixtures/server.lua`
Enter
Sleep 2s
Show
Sleep 800ms

Hide
Type ":Demo a layout worth keeping - three files, three windows"
Enter
Sleep 1500ms
Show

Type ":vsplit demos/fixtures/config.json"
Sleep 400ms
Enter
Sleep 900ms
Type ":split demos/fixtures/todo.md"
Sleep 400ms
Enter
Sleep 1500ms

Hide
Type ":Demo :Session save - named after the project, no name to invent"
Enter
Sleep 1500ms
Show

Type ":Session save"
Sleep 600ms
Enter
Sleep 2500ms

Hide
Type ":Demo :only - and the layout is gone"
Enter
Sleep 1500ms
Show

Type ":only"
Sleep 500ms
Enter
Sleep 2s

Hide
Type ":Demo :Session load - and back"
Enter
Sleep 1500ms
Show

Type ":Session load"
Sleep 600ms
Enter
Sleep 3500ms

Hide
Type ":qa!"
Enter
