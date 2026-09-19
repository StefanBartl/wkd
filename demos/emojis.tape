# emojis.nvim -- count, replace with :name: placeholders, restore, list.
Source demos/_settings.tape
Output out/emojis.webm
Output out/emojis.mp4
Env DEMO_PLUGIN "emojis"
Env DEMO_DEPS "lib,ui,cascade"
Hide
Type `cd "${WKD_ROOT:-$GITHUB_WORKSPACE}" && clear && nvim -u demos/init.lua demos/fixtures/notes.md`
Enter
Sleep 2s
Show
Sleep 800ms

Hide
Type ":Demo :Emojis count"
Enter
Sleep 1500ms
Show

Type ":Emojis count"
Sleep 500ms
Enter
Sleep 2s

Hide
Type ":Demo :Emojis replace - emojis to :name: placeholders"
Enter
Sleep 1500ms
Show

Type ":Emojis replace"
Sleep 500ms
Enter
Sleep 2500ms

Hide
Type ":Demo :Emojis unreplace - and back"
Enter
Sleep 1500ms
Show

Type ":Emojis unreplace"
Sleep 500ms
Enter
Sleep 2s

Hide
Type ":Demo :Emojis list - every emoji in the quickfix list"
Enter
Sleep 1500ms
Show

Type ":Emojis list"
Sleep 500ms
Enter
Sleep 800ms
Type ":copen"
Enter
Sleep 2500ms

Hide
Type ":qa!"
Enter
