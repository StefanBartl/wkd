// Random neon hover colour for the plugin tiles and the category pills of the
// modern skin. The colours themselves are CSS (--neon-N in modern.css); this
// only picks which one an element shows the next time it is hovered, via
// data-hue -- an attribute, so it stays clear of the style-src policy.
const HUES = 5;
const TARGET = '.m-card, .m-filter label';

let last = -1;

function pick(e: Event): void {
  const el = e.target instanceof Element ? e.target.closest<HTMLElement>(TARGET) : null;
  if (!el) return;
  if (e.type === 'pointerover') {
    // pointerover also fires when moving between children of the same tile.
    const from = (e as PointerEvent).relatedTarget;
    if (from instanceof Node && el.contains(from)) return;
  } else if (!el.matches(':focus-visible')) {
    // A click focuses the tile it is already hovering: re-rolling now would
    // flip its colour right before the page changes. Only keyboard focus counts.
    return;
  }
  // Never the same colour twice in a row, so moving across the grid always changes.
  let hue = Math.floor(Math.random() * (HUES - 1));
  if (last >= 0 && hue >= last) hue++;
  last = hue;
  el.dataset.hue = String(hue);
}

// The TUI skin has no tiles or pills; do not listen to every pointer move there.
if (document.documentElement.dataset.skin === 'modern') {
  document.addEventListener('pointerover', pick);
  document.addEventListener('focusin', pick);
}
