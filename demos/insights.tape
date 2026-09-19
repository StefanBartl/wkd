# insights.nvim -- static analysis of the project you are in.
Source demos/_settings.tape
Output out/insights.webm
Output out/insights.mp4
Env DEMO_PLUGIN "insights"
Env DEMO_DEPS "lib,ui"
Hide
Type `cd "${WKD_ROOT:-$GITHUB_WORKSPACE}/demos/fixtures" && clear && nvim -u ../init.lua worker.lua`
Enter
Sleep 2s
Type ":Demo annotation comments - TODO, FIX, HACK coloured as you read"
Enter
Sleep 500ms
Show
Sleep 3500ms

Hide
Type ":DemoDump at-start"
Enter
Sleep 300ms
Type ":Demo :Insights fileinfo - fs.stat of the buffer in a float"
Enter
Sleep 1500ms
Type ":DemoDump before-fileinfo"
Enter
Sleep 300ms
Show

Type ":Insights fileinfo"
Sleep 600ms
Enter
Sleep 3s
Type ":Insights fileinfo"
Sleep 400ms
Enter
Sleep 800ms

Hide
Type ":Demo :Insights todos - every annotation in the tree, to the quickfix list"
Enter
Sleep 1500ms
Show

Type ":Insights todos TODO FIX HACK qf"
Sleep 600ms
Enter
Sleep 1500ms
Type "j"
Sleep 600ms
Type "j"
Sleep 600ms
Enter
Sleep 2500ms

Hide
Type ":qa!"
Enter
