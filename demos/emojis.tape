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
Sleep 1200ms

Type ":Emojis count"
Sleep 500ms
Enter
Sleep 2s

Type ":Emojis replace"
Sleep 500ms
Enter
Sleep 2500ms

Type ":Emojis unreplace"
Sleep 500ms
Enter
Sleep 2s

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
