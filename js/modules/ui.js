// ── UI / PAGE NAVIGATION ───────────────────────────────────────────────────────
// Page switching, sidebar sync, responsive layout.

import { renderStadiumMap } from './map.js';
import { showToast }        from './toast.js';

export function showPage(id, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  if (el) el.classList.add('active');
  if (id === 'map') renderStadiumMap();
}

export function syncSidebar(id) {
  document.querySelectorAll('.sidebar-nav-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('snav-' + id);
  if (btn) btn.classList.add('active');
}

export function checkDesktop() {
  const isDesktop = window.innerWidth >= 768;
  const sidebar = document.getElementById('sidebar-desktop');
  if (sidebar) sidebar.style.display = isDesktop ? 'flex' : 'none';
}

export function updateOnlineStatus() {
  const dot = document.querySelector('.live-dot');
  if (!dot) return;
  dot.style.background = navigator.onLine ? '#22c55e' : '#f59e0b';
}
