// ── MAIN ENTRY POINT ───────────────────────────────────────────────────────────
// Imports all modules, exposes window functions for inline HTML handlers,
// wires global event listeners, and boots the app.

import './modules/firebase-config.js';

import { state }              from './modules/state.js';
import { PAGE_ORDER }         from './modules/config.js';
import { showToast }          from './modules/toast.js';

import { renderAll }          from './modules/render.js';
import { syncOfflineQueue }   from './modules/api.js';

import { setPlatform, setStatusFilter, applyFilters, clearQ,
         clearVenueFilter, venueFilterChip, venueFilter, kpiFilter } from './modules/filters.js';

import { showPage, syncSidebar, checkDesktop, updateOnlineStatus }   from './modules/ui.js';

import { renderStadiumMap, setVenue, openAssignModal }               from './modules/map.js';

import { openModal, closeModal, closeOverlay,
         setInstalled, confirmTechModal, cancelTechModal,
         updateZoneOptions, saveVenueAssignment,
         captureLocation, clearLocation,
         uploadPhoto, openLightbox, closeLightbox, deletePhoto,
         exportUnitExcel, exportUnitPDF, toggleFieldMode, testEmail } from './modules/modal.js';

import { exportExcel, exportPDF }                                    from './modules/export.js';

import { openActivityLog, loadActivityLog, filterActivity }          from './modules/activity.js';

import { initAuthGuard, handleSignOut, guardEdit, enterReadOnly,
         initEmailJS }                                               from './modules/auth.js';

// ── EXPOSE WINDOW FUNCTIONS (required by inline onclick="" attributes) ─────────
window.openModal           = openModal;
window.closeModal          = closeModal;
window.closeOverlay        = closeOverlay;
window.setInstalled        = setInstalled;
window.confirmTechModal    = confirmTechModal;
window.cancelTechModal     = cancelTechModal;
window.updateZoneOptions   = updateZoneOptions;
window.saveVenueAssignment = saveVenueAssignment;
window.captureLocation     = captureLocation;
window.clearLocation       = clearLocation;
window.uploadPhoto         = uploadPhoto;
window.openLightbox        = openLightbox;
window.closeLightbox       = closeLightbox;
window.deletePhoto         = deletePhoto;
window.exportUnitExcel     = exportUnitExcel;
window.exportUnitPDF       = exportUnitPDF;
window.toggleFieldMode     = toggleFieldMode;
window.testEmail           = testEmail;

window.setPlatform         = setPlatform;
window.setStatusFilter     = setStatusFilter;
window.applyFilters        = applyFilters;
window.clearQ              = clearQ;
window.clearVenueFilter    = clearVenueFilter;
window.venueFilterChip     = venueFilterChip;
window.venueFilter         = venueFilter;
window.kpiFilter           = kpiFilter;

window.showPage            = showPage;
window.syncSidebar         = syncSidebar;

window.setVenue            = setVenue;
window.renderStadiumMap    = renderStadiumMap;
window.openAssignModal     = openAssignModal;

window.exportExcel         = exportExcel;
window.exportPDF           = exportPDF;

window.openActivityLog     = openActivityLog;
window.loadActivityLog     = loadActivityLog;
window.filterActivity      = filterActivity;

window.guardEdit           = guardEdit;
window.enterReadOnly       = enterReadOnly;
window.handleSignOut       = handleSignOut;

window.showToast           = showToast;

// ── BOOT ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initEmailJS();
  await initAuthGuard();
  checkDesktop();
  updateOnlineStatus();

  // Logout buttons — disable + show feedback while handleSignOut() completes.
  ['logout-btn', 'logout-btn-sidebar'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', async () => {
      el.disabled    = true;
      el.textContent = 'Signing out…';
      await handleSignOut();
    });
  });
});

// ── RESIZE ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', checkDesktop);

// ── FAB SCROLL ────────────────────────────────────────────────────────────────
window.addEventListener('scroll', () => {
  const fab = document.getElementById('fab');
  if (fab) fab.classList.toggle('show', window.scrollY > 200);
});

// ── ONLINE / OFFLINE ──────────────────────────────────────────────────────────
window.addEventListener('online', () => {
  showToast('🌐 Back online');
  updateOnlineStatus();
  setTimeout(syncOfflineQueue, 1000);
});
window.addEventListener('offline', updateOnlineStatus);

// Sync queue on page load if online
window.addEventListener('load', () => {
  if (navigator.onLine) setTimeout(syncOfflineQueue, 3000);
  checkDesktop();
});

// ── SWIPE BETWEEN TABS ────────────────────────────────────────────────────────
document.addEventListener('touchstart', e => {
  state.touchStartX = e.touches[0].clientX;
  state.touchStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - state.touchStartX;
  const dy = e.changedTouches[0].clientY - state.touchStartY;
  if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;
  if (document.getElementById('overlay').classList.contains('open')) return;
  const currentPage = document.querySelector('.page.active')?.id?.replace('page-', '');
  const idx         = PAGE_ORDER.indexOf(currentPage);
  if (idx === -1) return;
  const nextIdx = dx < 0 ? Math.min(idx + 1, PAGE_ORDER.length - 1) : Math.max(idx - 1, 0);
  if (nextIdx === idx) return;
  const nextId  = PAGE_ORDER[nextIdx];
  const nextTab = document.querySelector(`.tab[onclick*="${nextId}"]`);
  if (nextTab) showPage(nextId, nextTab);
});
