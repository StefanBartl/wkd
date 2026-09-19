# spotlight.nvim -- mark several tokens in a log, each in its own colour.
Source demos/_settings.tape
Output out/spotlight.webm
Output out/spotlight.mp4
Env DEMO_PLUGIN "spotlight"
Env DEMO_DEPS "lib,ui"
Hide
Type `cd "${WKD_ROOT:-$GITHUB_WORKSPACE}" && clear && nvim -u demos/init.lua demos/fixtures/app.log`
Enter
Sleep 2s
Show
Sleep 800ms

Hide
Type ":Demo :Spotlight add - mark a token everywhere"
Enter
Sleep 1500ms
Show

Type ":Spotlight add ERROR"
Sleep 500ms
Enter
Sleep 1200ms
Type ":Spotlight add timeout"
Sleep 500ms
Enter
Sleep 1200ms
Type ":Spotlight add user=17"
Sleep 500ms
Enter
Sleep 1800ms

Hide
Type ":Demo :Spotlight - toggle the token under the cursor"
Enter
Sleep 1500ms
Show

Type "2G"
Type "$"
Type "b"
Sleep 600ms
Type ":Spotlight"
Sleep 400ms
Enter
Sleep 1800ms

Hide
Type ":Demo :Spotlight clear"
Enter
Sleep 1500ms
Show

Type ":Spotlight clear"
Sleep 400ms
Enter
Sleep 1800ms

Hide
Type ":qa!"
Enter
