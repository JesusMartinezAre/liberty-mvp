// ── FILTERS ────────────────────────────────────────────────────────────────────
// All filter state mutations and UI sync for platform/status/venue/search.

import { state }                  from './state.js';
import { renderList }             from './render.js';
import { showPage, syncSidebar }  from './ui.js';

export function setPlatform(p, el) {
  state.filterPlatform = p;
  state.filterVenue    = '';
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderList();
}

export function setStatusFilter(s, el) {
  state.filterStatus = s;
  state.filterVenue  = '';
  document.querySelectorAll('.sf').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderList();
}

export function applyFilters() {
  state.filterQ = document.getElementById('q').value;
  renderList();
}

export function clearQ() {
  document.getElementById('q').value = '';
  state.filterQ = '';
  renderList();
  const overviewTab = document.querySelector('.tab[onclick*="overview"]');
  if (overviewTab) { showPage('overview', overviewTab); syncSidebar('overview'); }
}

export function clearVenueFilter() {
  state.filterVenue = '';
  renderList();
}

export function venueFilterChip(v, el) {
  state.filterVenue  = v;
  state.filterStatus = '';
  document.querySelectorAll('.sf').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  renderList();
}

export function venueFilter(v) {
  state.filterPlatform = 'all';
  state.filterStatus   = '';
  state.filterVenue    = v;
  state.filterQ        = '';
  const qb = document.getElementById('q');
  if (qb) qb.value = '';

  document.querySelectorAll('.sf').forEach(c => c.classList.remove('active'));
  const allChip  = document.querySelector('.sf[data-s=""]');
  if (allChip) allChip.classList.add('active');
  const chip = document.querySelector(`.sf[data-v="${v}"]`);
  if (chip) chip.classList.add('active');

  const inventoryTab = document.querySelector('.tab[onclick*="inventory"]');
  showPage('inventory', inventoryTab);

  renderList();
  setTimeout(() => {
    const el = document.getElementById('item-list');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

export function kpiFilter(platform, status) {
  state.filterPlatform = platform;
  state.filterStatus   = status;
  state.filterVenue    = '';
  state.filterQ        = '';
  document.getElementById('q').value = '';

  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  const chipMap = { all: 'cf-all', POPA: 'cf-nav', KOS: 'cf-kos' };
  const chip = document.getElementById(chipMap[platform] || 'cf-all');
  if (chip) chip.classList.add('active');

  document.querySelectorAll('.sf').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.sf').forEach(c => {
    if (c.dataset.s === status) c.classList.add('active');
    if (!status && c.dataset.s === '') c.classList.add('active');
  });

  const inventoryTab = document.querySelector('.tab[onclick*="inventory"]');
  showPage('inventory', inventoryTab);
  renderList();
}
