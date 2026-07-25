// شاشة السجل والأرشيف — شبكة الأمان: تراجع عن أي عملية واسترجاع أي محذوف

import { $, el, tpl, esc, toast, toastError, confirmDialog, emptyState, fmtTime, dayLabel } from '../ui.js';
import { getState, mutate } from '../store.js';
import { api } from '../api.js';

let onAfterMutate = () => {};
let archiveCache = null;

export function initHistory({ afterMutate }) {
  onAfterMutate = afterMutate;

  $('#btn-tab-log').addEventListener('click', () => switchTab('log'));
  $('#btn-tab-archive').addEventListener('click', () => switchTab('archive'));
  switchTab('log');
}

function switchTab(which) {
  const isLog = which === 'log';
  $('#history-list').classList.toggle('d-none', !isLog);
  $('#archive-list').classList.toggle('d-none', isLog);
  $('#btn-tab-log').classList.toggle('active', isLog);
  $('#btn-tab-archive').classList.toggle('active', !isLog);
  if (isLog) render();
  else loadArchive();
}

/* ------------------------------ السجل ------------------------------ */

export function render() {
  const host = $('#history-list');
  const log = getState().log || [];
  host.replaceChildren();

  if (!log.length) {
    host.append(emptyState({
      icon: 'bi-clock-history',
      title: 'السجل فارغ',
      text: 'كل عملية تقوم بها ستظهر هنا مع إمكانية التراجع عنها.',
    }));
    return;
  }

  let currentDay = null;
  for (const entry of log) {
    const day = dayLabel(entry.timestamp);
    if (day !== currentDay) {
      currentDay = day;
      host.append(el('h6', 'text-muted fw-bold small mt-3 mb-2 px-1', esc(day)));
    }
    host.append(logItem(entry));
  }
}

function logItem(entry) {
  const n = tpl('tpl-log-item');
  $('.log-time', n).textContent = fmtTime(entry.timestamp);
  $('.log-title', n).textContent = entry.action;
  $('.log-desc', n).textContent = entry.summary_ar || '';

  const badge = $('.log-badge', n);
  if (entry.undone === 'نعم') {
    badge.className = 'log-badge badge rounded-pill text-bg-secondary';
    badge.textContent = 'تم التراجع';
    n.classList.add('opacity-50');
  } else if (entry.action === 'تراجع') {
    badge.className = 'log-badge badge rounded-pill text-bg-warning';
    badge.textContent = 'عملية تراجع';
  } else badge.remove();

  const btn = $('.btn-undo', n);
  if (!entry.can_undo) {
    btn.disabled = true;
    btn.title = entry.undone === 'نعم' ? 'تم التراجع عن هذه العملية بالفعل' : 'التراجع غير متاح لهذه العملية';
  } else {
    btn.addEventListener('click', () => doUndo(entry, btn));
  }
  return n;
}

async function doUndo(entry, btn, force = false) {
  if (!force) {
    const okGo = await confirmDialog({
      title: 'تأكيد التراجع',
      body: `سيتم التراجع عن: ${entry.summary_ar}`,
      confirmText: 'تراجع',
      danger: false,
    });
    if (!okGo) return;
  }

  btn.disabled = true;
  try {
    const res = await mutate(() => api.undo(entry.id, force));
    onAfterMutate();

    if (res.skipped?.length) {
      const reasons = res.skipped.map((s) => `• ${s.name || s.id}: ${s.reason}`).join('\n');
      const again = await confirmDialog({
        title: 'تراجع جزئي',
        body: `${res.message}\n\nالمستثنى:\n${reasons}\n\nهل تريد فرض التراجع على المستثنى؟ سيمسح أي تعديل أحدث.`,
        confirmText: 'تراجع بالقوة',
      });
      if (again) return doUndo(entry, btn, true);
    } else {
      toast(res.message || 'تم التراجع بنجاح', { type: 'success' });
    }
  } catch (e) {
    toastError(e);
    btn.disabled = false;
  }
}

/* ------------------------------ الأرشيف ------------------------------ */

async function loadArchive() {
  const host = $('#archive-list');
  host.replaceChildren(el('div', 'text-center py-4',
    '<div class="spinner-border text-primary"></div><p class="text-muted small mt-2 mb-0">جاري تحميل الأرشيف...</p>'));
  try {
    const data = await api.listArchive();
    archiveCache = data.archive || [];
    renderArchive();
  } catch (e) {
    host.replaceChildren(el('div', 'alert alert-danger', esc(e.message)));
  }
}

function renderArchive() {
  const host = $('#archive-list');
  host.replaceChildren();

  if (!archiveCache?.length) {
    host.append(emptyState({
      icon: 'bi-archive',
      title: 'الأرشيف فارغ',
      text: 'كل ما تحذفه ينتقل إلى هنا ويمكن استرجاعه.',
    }));
    return;
  }

  for (const rec of archiveCache) {
    const card = el('div', 'card border-0 shadow-sm p-3 mb-2');
    const row = el('div', 'd-flex align-items-start justify-content-between gap-2');

    const info = el('div');
    info.append(el('div', 'fw-bold', esc(rec.name || '—')));
    const meta = [rec.entity, rec.phone, rec.level, rec.mentor].filter(Boolean).join(' • ');
    info.append(el('div', 'text-muted small', esc(meta)));
    info.append(el('div', 'text-muted fs-8 mt-1',
      'حُذف في ' + esc(new Date(rec.deleted_at).toLocaleString('ar-EG'))));

    const btn = el('button', 'btn btn-sm btn-outline-success fw-bold flex-shrink-0',
      '<i class="bi bi-arrow-counterclockwise"></i> استرجاع');
    btn.type = 'button';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await mutate(() => api.restore(rec.id));
        onAfterMutate();
        toast(`تم استرجاع ${rec.name}`, { type: 'success' });
        await loadArchive();
      } catch (e) {
        toastError(e);
        btn.disabled = false;
      }
    });

    row.append(info, btn);
    card.append(row);
    host.append(card);
  }
}
