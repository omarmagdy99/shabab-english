// نقطة الدخول: البوابة، التنقل، المزامنة، وربط الشاشات الأربع

import { $, $$, el, initSheet, toast, toastError, setBusy } from './ui.js';
import { setPass, clearPass, getPass, call } from './api.js';
import { hydrateFromCache, refresh, subscribe, clearCache, getState } from './store.js';
import { onQueryChange } from './query.js';
import * as students from './views/students.js';
import * as teachers from './views/teachers.js';
import * as messages from './views/messages.js';
import * as history from './views/history.js';

let current = 'students';
let booted = false;

/* ------------------------------ البوابة ------------------------------ */

function showGate(message) {
  $('#gate').classList.remove('d-none');
  $('#app').classList.add('d-none');
  const err = $('#gate-error');
  if (message) { err.textContent = message; err.classList.remove('d-none'); }
  else err.classList.add('d-none');
  $('#gate-pass').value = '';
  setTimeout(() => $('#gate-pass').focus(), 100);
}

function showApp() {
  $('#gate').classList.add('d-none');
  $('#app').classList.remove('d-none');
}

function initGate() {
  $('#gate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#gate-form [type="submit"]');
    const pass = $('#gate-pass').value.trim();
    if (!pass) return;

    setBusy(btn, true, 'جاري التحقق...');
    try {
      await call('list', {}, { pass });     // نتحقق من الرمز قبل حفظه
      setPass(pass);
      showApp();
      await boot();
    } catch (err) {
      showGate(err.code === 401 ? 'الرقم السري غير صحيح.' : err.message);
    } finally { setBusy(btn, false); }
  });

  $('#btn-lock').addEventListener('click', () => {
    clearPass();
    clearCache();
    location.reload();
  });
}

/* ------------------------------ التنقل ------------------------------ */

function navigate(screen) {
  current = screen;
  ['students', 'teachers', 'messages', 'history'].forEach((s) => {
    $(`#screen-${s}`).classList.toggle('d-none', s !== screen);
  });
  $$('[data-nav]').forEach((b) => b.classList.toggle('active', b.dataset.nav === screen));
  window.scrollTo({ top: 0 });
  renderCurrent();
}

function renderCurrent() {
  if (!booted) return;
  if (current === 'students') students.render();
  else if (current === 'teachers') teachers.render();
  else if (current === 'messages') messages.render();
  else if (current === 'history') history.render();
}

/** بعد أي عملية كتابة: نحدّث الشاشة الحالية وأي شاشة تعتمد على نفس البيانات */
function renderAll() {
  if (!booted) return;
  students.render();
  teachers.render();
  messages.render();
  history.render();
}

/* ------------------------------ المزامنة ------------------------------ */

function paintSync() {
  const { syncing, lastSync, error } = getState();
  const host = $('#sync-status');
  const dot = $('.status-dot', host);
  const text = $('.status-text', host);
  if (!dot || !text) return;

  if (syncing) {
    dot.className = 'status-dot status-syncing';
    text.textContent = 'جاري التحديث...';
  } else if (error) {
    dot.className = 'status-dot status-offline';
    text.textContent = 'تعذّر الاتصال';
  } else if (lastSync) {
    dot.className = 'status-dot status-online';
    text.textContent = 'آخر تحديث ' + new Date(lastSync).toLocaleTimeString('ar-EG',
      { hour: '2-digit', minute: '2-digit' });
  } else {
    dot.className = 'status-dot status-online';
    text.textContent = 'متصل';
  }
}

async function doRefresh({ silent = false } = {}) {
  try {
    await refresh({ silent });
    renderCurrent();
    if (!silent) toast('تم تحديث البيانات', { type: 'success', delay: 2000 });
  } catch (e) {
    if (e.code === 401) { clearPass(); return showGate('انتهت صلاحية الرقم السري. أدخله مرة أخرى.'); }
    if (!silent) toastError(e);
  }
}

/* ------------------------------ الإقلاع ------------------------------ */

async function boot() {
  if (!booted) {
    students.initStudents({ afterMutate: renderAll });
    teachers.initTeachers({ afterMutate: renderAll, navigate });
    messages.initMessages();
    history.initHistory({ afterMutate: renderAll });
    booted = true;
  }

  const hadCache = hydrateFromCache();
  navigate(current);
  if (hadCache) renderCurrent();
  await doRefresh({ silent: true });
  renderCurrent();
}

function main() {
  initSheet();
  initGate();

  $('#btn-refresh').addEventListener('click', () => doRefresh());
  $$('[data-nav]').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.nav)));

  subscribe(paintSync);
  onQueryChange(() => {
    if (current === 'students') students.render();
    else if (current === 'messages') messages.render();
  });

  if (getPass()) { showApp(); boot(); }
  else showGate();
}

// الوحدات (type="module") مؤجّلة وتُنفّذ قبل DOMContentLoaded، لكن نتحوّط للحالتين
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
else main();
