# documentation.nvim -- a repository's own shape, written down.
Source demos/_settings.tape
Output out/documentation.webm
Output out/documentation.mp4
Env DEMO_PLUGIN "documentation"
Env DEMO_DEPS "lib,ui,cascade"
Hide
Type `cd "${WKD_ROOT:-$GITHUB_WORKSPACE}" && clear && nvim -u demos/init.lua "${PLUGINS_DIR:-..}/cascade.nvim/lua/cascade/init.lua"`
Enter
Sleep 2s
Show
Sleep 800ms

Hide
Type ":Demo :DocMap mermaid tree - the module tree of the repo you are in"
Enter
Sleep 1500ms
Show

Type ":DocMap mermaid tree"
Sleep 600ms
Enter
Sleep 4s

Hide
Type ":Demo :DocMap mermaid deps - the require graph, ready for a README"
Enter
Sleep 1500ms
Show

Type ":e #"
Sleep 300ms
Enter
Sleep 600ms
Type ":DocMap mermaid deps"
Sleep 600ms
Enter
Sleep 4s

Hide
Type ":qa!"
Enter
