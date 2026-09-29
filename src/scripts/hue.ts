// Random neon hover colour for the plugin tiles and the category pills of the
// modern skin. The colours themselves are CSS (--neon-N in modern.css); this
// only picks which one an element shows the next time it is hovered, via
// data-hue -- an attribute, so it stays clear of the style-src policy.
const HUES = 5;
const TARGET = '.m-card, .m-filter label, .m-filter input';

let last = Math.floor(Math.random() * HUES);

function pick(e: Event): void {
  const hit = e.target instanceof Element ? e.target.closest<HTMLElement>(TARGET) : null;
  if (!hit) return;
  // Keyboard focus lands on the (visually hidden) radio, not its sibling
  // <label> -- closest() can't reach a sibling, so resolve to the label that
  // actually carries the neon styling via the input/label association.
  const el = hit instanceof HTMLInputElement ? hit.labels?.[0] : hit;
  if (!el) return;
  if (e.type === 'pointerover') {
    // pointerover also fires when moving between children of the same tile.
    const from = (e as PointerEvent).relatedTarget;
    if (from instanceof Node && el.contains(from)) return;
  } else if (!hit.matches(':focus-visible')) {
    // A click focuses the tile it is already hovering: re-rolling now would
    // flip its colour right before the page changes. Only keyboard focus counts.
    return;
  }
  // Never the same colour twice in a row, so moving across the grid always changes.
  let hue = Math.floor(Math.random() * (HUES - 1));
  if (hue >= last) hue++;
  last = hue;
  el.dataset.hue = String(hue);
}

// The TUI skin has no tiles or pills; do not listen to every pointer move there.
if (document.documentElement.dataset.skin === 'modern') {
  document.addEventListener('pointerover', pick);
  document.addEventListener('focusin', pick);
}
