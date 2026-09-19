# replacer.nvim -- plan a rename with --dry, then apply it with --all.
Source demos/_settings.tape
Output out/replacer.webm
Output out/replacer.mp4
Env DEMO_PLUGIN "replacer"
Env DEMO_DEPS "lib,ui"
Hide
Type `cd "${WKD_ROOT:-$GITHUB_WORKSPACE}" && clear && nvim -u demos/init.lua demos/fixtures/server.lua`
Enter
Sleep 2s
Show
Sleep 800ms

Hide
Type ":Demo :Replace old new --dry - plan first, write nothing"
Enter
Sleep 1500ms
Show

Type ":Replace fetch_user load_user --dry"
Sleep 600ms
Enter
Sleep 3500ms

Hide
Type ":Demo :Replace old new --all - apply everywhere"
Enter
Sleep 1500ms
Show

Type ":Replace fetch_user load_user --all"
Sleep 600ms
Enter
Sleep 3s

Hide
Type ":qa!"
Enter
