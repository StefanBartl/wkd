// Grid/Tree/Orbit switching itself is pure CSS (radio inputs + :has(), see
// modern.css) and needs no script. Two things CSS can't express on its own:
// Escape back to Grid, and revealing a non-Grid view once, after the
// visitor has sat idle a while without ever touching the switcher. Both are
// additions on top of a page that already works without this file.
const gridRadio = document.getElementById('view-grid');
const treeRadio = document.getElementById('view-tree');
const orbitRadio = document.getElementById('view-orbit');

if (gridRadio instanceof HTMLInputElement) {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !gridRadio.checked) gridRadio.checked = true;
  });
}

const IDLE_MS = 20_000;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// One-shot, and only ever toward a view the visitor never picked themselves:
// setting .checked from here doesn't fire 'change' (only real input does),
// so this can't mistake its own move for the visitor having touched the tabs.
if (
  !reduceMotion &&
  gridRadio instanceof HTMLInputElement &&
  treeRadio instanceof HTMLInputElement &&
  orbitRadio instanceof HTMLInputElement
) {
  const radios = [gridRadio, treeRadio, orbitRadio];
  let touchedByUser = false;
  let revealed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const arm = (): void => {
    if (touchedByUser || revealed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (touchedByUser || revealed || !gridRadio.checked) return;
      revealed = true;
      (Math.random() < 0.5 ? treeRadio : orbitRadio).checked = true;
    }, IDLE_MS);
  };

  for (const radio of radios) {
    radio.addEventListener('change', () => {
      touchedByUser = true;
      clearTimeout(timer);
    });
  }
  for (const type of ['mousemove', 'keydown', 'scroll', 'touchstart']) {
    document.addEventListener(type, arm, { passive: true });
  }
  arm();
}
