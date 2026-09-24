// Progressive enhancement over the four static stat tiles: without this,
// the four values from src/pages/index.astro's frontmatter just sit there,
// correct and final. With it, a slot swaps to a different metric from the
// pool every few seconds, one at a time so the page stays legible instead
// of flashing all four at once.
interface Metric {
  label: string;
  value: string;
}

const dl = document.querySelector<HTMLElement>('.m-stats[data-stats-pool]');
if (dl) {
  let pool: Metric[] = [];
  try {
    pool = JSON.parse(dl.dataset.statsPool ?? '[]');
  } catch {
    pool = [];
  }

  const slots = [...dl.querySelectorAll<HTMLElement>(':scope > div')];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SWAP_MS = 260;
  const MIN_INTERVAL = 4000;
  const MAX_INTERVAL = 8000;

  function currentLabels(): string[] {
    return slots.map((s) => s.querySelector('.m-stat-label')?.textContent ?? '');
  }

  function swapOnce(): void {
    if (pool.length <= slots.length) return; // nothing new to rotate in
    const shown = currentLabels();
    const slot = slots[Math.floor(Math.random() * slots.length)];
    const candidates = pool.filter((m) => !shown.includes(m.label));
    const next = candidates[Math.floor(Math.random() * candidates.length)];
    if (!slot || !next) return;

    const label = slot.querySelector<HTMLElement>('.m-stat-label');
    const value = slot.querySelector<HTMLElement>('.m-stat-value');
    if (!label || !value) return;

    const apply = (): void => {
      label.textContent = next.label;
      value.textContent = next.value;
    };

    if (reduceMotion) {
      apply();
    } else {
      label.classList.add('is-swapping');
      value.classList.add('is-swapping');
      setTimeout(() => {
        apply();
        label.classList.remove('is-swapping');
        value.classList.remove('is-swapping');
      }, SWAP_MS);
    }
  }

  function loop(): void {
    swapOnce();
    const delay = MIN_INTERVAL + Math.random() * (MAX_INTERVAL - MIN_INTERVAL);
    setTimeout(loop, delay);
  }

  if (pool.length > slots.length) loop();
}
