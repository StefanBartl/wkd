# recommender.nvim -- repeated dotted chains, suggested as local aliases.
Source demos/_settings.tape
Output out/recommender.webm
Output out/recommender.mp4
Env DEMO_PLUGIN "recommender"
Env DEMO_DEPS "lib,ui"
Hide
Type `cd "${WKD_ROOT:-$GITHUB_WORKSPACE}" && clear && nvim -u demos/init.lua demos/fixtures/plugin.lua`
Enter
Sleep 2s
Show
Sleep 800ms

Hide
Type ":Demo :Recommender - chains repeated in this buffer, and the alias for each"
Enter
Sleep 1500ms
Show

Type ":Recommender"
Sleep 600ms
Enter
Sleep 3s

Hide
Type ":Demo j and Enter - pick a suggestion, insert its alias"
Enter
Sleep 1500ms
Show

Type "j"
Sleep 800ms
Type "j"
Sleep 800ms
Enter
Sleep 3s

Hide
Type ":Demo :Recommender 2 - a lower threshold finds more"
Enter
Sleep 1500ms
Show

Type "gg"
Sleep 400ms
Type ":Recommender 2"
Sleep 600ms
Enter
Sleep 3500ms

Hide
Type ":qa!"
Enter
