# hover.nvim + media.nvim + pdfport.nvim -- what a video or PDF link says on hover.
# Per feature: <C-t> shows the title with a 3-second countdown, then the keys;
# past the last title, <C-t> shows the "loops from here" card.
Source demos/_settings.tape
Output out/hover-media.webm
Output out/hover-media.mp4
Env DEMO_PLUGIN "hover"
Env DEMO_DEPS "lib,ui,markdown,media,pdfport"
Env DEMO_TITLES ":Hover show on an mp4 link -> media.nvim probes it with ffprobe -> type, size, resolution, length|:Hover show on a PDF link -> pdfport.nvim renders page 1 in a graphics terminal -> here: what the float says|:Hover why on plain prose -> the gate that refused, and what would let it through"
Hide
Type `cd "${WKD_ROOT:-$GITHUB_WORKSPACE}" && clear && nvim -u demos/init.lua demos/fixtures/media.md`
Enter
Sleep 2s
# The probe media.nvim caches is what the float shows next to the badge; warm
# it up front so the first hover already carries resolution and length.
Type `:lua local m = require("media") for _, p in ipairs({ vim.fn.fnamemodify("demos/fixtures/intro.mp4", ":p"), vim.fs.normalize(vim.fn.fnamemodify("demos/fixtures/intro.mp4", ":p")) }) do m.probe(p, function() end) end`
Enter
Sleep 2500ms
Show
Sleep 800ms

Hide
Ctrl+T
Sleep 300ms
Show
Sleep 3s

Type "/intro.mp4"
Sleep 400ms
Enter
Sleep 800ms
Type ":Hover show"
Sleep 600ms
Enter
Sleep 4s

Hide
Ctrl+T
Sleep 300ms
Show
Sleep 3s

Type "/handbook.pdf"
Sleep 400ms
Enter
Sleep 800ms
Type ":Hover show"
Sleep 600ms
Enter
Sleep 4s

Hide
Ctrl+T
Sleep 300ms
Show
Sleep 3s

Type "/printable"
Sleep 400ms
Enter
Sleep 800ms
Type ":Hover why"
Sleep 600ms
Enter
Sleep 3500ms
Enter
Sleep 500ms

Hide
Ctrl+T
Sleep 200ms
Show
Sleep 2s

Hide
Type ":qa!"
Enter
