// Grid/Tree switching itself is pure CSS (radio inputs + :has(), see
// modern.css) and needs no script. Escape is the one interaction CSS can't
// express on its own -- everything still works without this file, just
// without the shortcut.
const gridRadio = document.getElementById('view-grid');

if (gridRadio instanceof HTMLInputElement) {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !gridRadio.checked) gridRadio.checked = true;
  });
}
