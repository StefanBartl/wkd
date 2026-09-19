# data.nvim -- pretty, sorted, flattened and converted JSON, in place.
Source demos/_settings.tape
Output out/data.webm
Output out/data.mp4
Env DEMO_PLUGIN "data"
Env DEMO_DEPS "lib,ui"
Hide
Type `cd "${WKD_ROOT:-$GITHUB_WORKSPACE}" && clear && nvim -u demos/init.lua demos/fixtures/config.json`
Enter
Sleep 2s
Show
Sleep 800ms

Hide
Type ":Demo :JSON - pretty-print in place"
Enter
Sleep 1500ms
Show

Type ":JSON"
Sleep 500ms
Enter
Sleep 2s

Hide
Type ":Demo :JSON sort - sorted keys"
Enter
Sleep 1500ms
Show

Type ":JSON sort"
Sleep 500ms
Enter
Sleep 2s

Hide
Type ":Demo :JSON lines - one path per leaf"
Enter
Sleep 1500ms
Show

Type ":JSON lines"
Sleep 500ms
Enter
Sleep 2500ms
Type "u"
Sleep 1200ms

Hide
Type ":Demo :JSON to yaml"
Enter
Sleep 1500ms
Show

Type ":JSON to yaml"
Sleep 500ms
Enter
Sleep 2500ms

Hide
Type ":qa!"
Enter
