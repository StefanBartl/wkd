# ui.nvim -- the frame around the window: zen, colour picker, notifications.
Source demos/_settings.tape
Output out/ui.webm
Output out/ui.mp4
Env DEMO_PLUGIN "ui"
Env DEMO_DEPS "lib"
Hide
Type `cd "${WKD_ROOT:-$GITHUB_WORKSPACE}" && clear && nvim -u demos/init.lua demos/fixtures/theme.lua`
Enter
Sleep 2s
Show
Sleep 800ms

Hide
Type ":Demo :UI zen - the buffer alone, centred, everything else dimmed"
Enter
Sleep 1500ms
Show

Type ":UI zen"
Sleep 600ms
Enter
Sleep 3s
Type ":UI zen off"
Sleep 500ms
Enter
Sleep 1200ms

Hide
Type ":Demo :UI color - a colour picker over the hex under the cursor"
Enter
Sleep 1500ms
Show

Type "3G"
Sleep 300ms
Type "fu"
Sleep 300ms
Type "f#"
Sleep 600ms
Type ":UI color"
Sleep 600ms
Enter
Sleep 2s
Type "l"
Sleep 500ms
Type "l"
Sleep 500ms
Type "j"
Sleep 500ms
Type "j"
Sleep 1500ms
Type "q"
Sleep 1200ms

Hide
Type ":Demo ui.notify - vim.notify as level-coloured toasts"
Enter
Sleep 1500ms
Show

Type `:lua vim.notify("deploy finished: 3 services, 0 errors")`
Sleep 400ms
Enter
Sleep 1200ms
Type `:lua vim.notify("disk 91% full", vim.log.levels.WARN)`
Sleep 400ms
Enter
Sleep 1200ms
Type `:lua vim.notify("worker-2 unreachable", vim.log.levels.ERROR)`
Sleep 400ms
Enter
Sleep 3s

Hide
Type ":qa!"
Enter
