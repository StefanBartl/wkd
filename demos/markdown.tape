# markdown.nvim -- one :Markdown command: TOC, tables, structure.
Source demos/_settings.tape
Output out/markdown.webm
Output out/markdown.mp4
Env DEMO_PLUGIN "markdown"
Env DEMO_DEPS "lib,ui,hover"
Hide
Type `cd "${WKD_ROOT:-$GITHUB_WORKSPACE}" && clear && nvim -u demos/init.lua demos/fixtures/guide.md`
Enter
Sleep 2s
Show
Sleep 800ms

Hide
Type ":Demo :Markdown toc - table of contents + section spacing"
Enter
Sleep 1500ms
Show

Type ":Markdown toc"
Sleep 600ms
Enter
Sleep 3s

Hide
Type ":Demo :Markdown table format - align a GFM table"
Enter
Sleep 1500ms
Show

Type "/canary"
Sleep 400ms
Enter
Sleep 800ms
Type ":Markdown table format"
Sleep 600ms
Enter
Sleep 3s

Hide
Type ":Demo :Markdown table view box - floating preview"
Enter
Sleep 1500ms
Show

Type ":Markdown table view box"
Sleep 600ms
Enter
Sleep 3s
Type "q"
Sleep 1200ms

Hide
Type ":qa!"
Enter
