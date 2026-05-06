// ── TOAST NOTIFICATION ───────────────────────────────────────────────────────
// Standalone leaf module — imported by many modules, imports nothing.

let _toastTimer;

export function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
