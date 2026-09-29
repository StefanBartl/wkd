// Grid/Tree/Orbit switching itself is pure CSS (radio inputs + :has(), see
// modern.css) and needs no script. Two things CSS can't express on its own:
// Escape back to Grid, and revealing a non-Grid view once, after the
// visitor has sat idle a while without ever touching the switcher. Both are
// additions on top of a page that already works without this file.
const gridRadio = document.getElementById('view-grid');
const treeRadio = document.getElementById('view-tree');
const orbitRadio = document.getElementById('view-orbit');
const fightRadio = document.getElementById('view-fight');

if (gridRadio instanceof HTMLInputElement) {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !gridRadio.checked) {
      gridRadio.checked = true;
      // A bare property assignment doesn't fire 'change' (only real input
      // does -- see the idle-timer's own comment on this further down).
      // Escape is a deliberate exit though, unlike that timer's own
      // automated move, so it should still reach anything keyed off
      // 'change' -- namely fight.ts pausing a running match.
      gridRadio.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

const IDLE_MS = 20_000;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// One-shot, and only ever toward a view the visitor never picked themselves:
// setting .checked from here doesn't fire 'change' (only real input does),
// so this can't mistake its own move for the visitor having touched the tabs.
// Fight is deliberately never a reveal candidate -- a fighting game taking
// over the page because the visitor stepped away for 20s would be a bad
// surprise, not a delightful one -- but picking it still counts as having
// touched the switcher, same as Tree/Orbit.
if (
  !reduceMotion &&
  gridRadio instanceof HTMLInputElement &&
  treeRadio instanceof HTMLInputElement &&
  orbitRadio instanceof HTMLInputElement
) {
  const allRadios = [gridRadio, treeRadio, orbitRadio, fightRadio].filter(
    (r): r is HTMLInputElement => r instanceof HTMLInputElement,
  );
  const revealCandidates = [treeRadio, orbitRadio];
  const IDLE_EVENTS = ['mousemove', 'keydown', 'scroll', 'touchstart'] as const;
  let touchedByUser = false;
  let revealed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Once either flag flips, arm() is a permanent no-op -- drop the listeners
  // instead of leaving them firing on every mousemove for the rest of the
  // page's life for nothing.
  const stopListening = (): void => {
    clearTimeout(timer);
    for (const type of IDLE_EVENTS) document.removeEventListener(type, arm);
  };

  const arm = (): void => {
    if (touchedByUser || revealed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (touchedByUser || revealed || !gridRadio.checked) return;
      revealed = true;
      const pick = revealCandidates[Math.floor(Math.random() * revealCandidates.length)];
      if (pick) pick.checked = true;
      stopListening();
    }, IDLE_MS);
  };

  for (const radio of allRadios) {
    radio.addEventListener('change', () => {
      touchedByUser = true;
      stopListening();
    });
  }
  for (const type of IDLE_EVENTS) document.addEventListener(type, arm, { passive: true });
  arm();
}
