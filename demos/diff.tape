# diff.nvim -- one :Diff command, any source against any target.
Source demos/_settings.tape
Output out/diff.webm
Output out/diff.mp4
Env DEMO_PLUGIN "diff"
Env DEMO_DEPS "lib,ui"
Hide
Type `cd "${WKD_ROOT:-$GITHUB_WORKSPACE}" && clear && nvim -u demos/init.lua demos/fixtures/todo.md`
Enter
Sleep 2s
Show
Sleep 800ms

Hide
Type ":Demo :Diff target=file - this buffer against a file"
Enter
Sleep 1500ms
Show

Type ":Diff target=demos/fixtures/todo-done.md"
Sleep 600ms
Enter
Sleep 3s

Hide
Type ":Demo ]c and [c - jump between hunks"
Enter
Sleep 1500ms
Show

Type "]c"
Sleep 900ms
Type "]c"
Sleep 900ms
Type "[c"
Sleep 1500ms

Hide
Type ":qa!"
Enter
