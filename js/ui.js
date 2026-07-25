// مكوّنات الواجهة المشتركة: الدرج السفلي، نافذة التأكيد، الإشعارات، وأدوات DOM

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

/** ينسخ قالباً ويعيد أول عنصر بداخله */
export function tpl(id) {
  const t = document.getElementById(id);
  if (!t) throw new Error('قالب غير موجود: ' + id);
  return t.content.firstElementChild.cloneNode(true);
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- الدرج السفلي ---------------- */

let sheetOnClose = null;

export function openSheet({ title, body, footer = null, onClose = null }) {
  const sheet = $('#sheet'), backdrop = $('#sheet-backdrop');
  $('#sheet-title').textContent = title || '';

  const bodyEl = $('#sheet-body');
  bodyEl.replaceChildren(body);
  bodyEl.scrollTop = 0;

  const footEl = $('#sheet-footer');
  if (footer) { footEl.replaceChildren(footer); footEl.classList.remove('d-none'); }
  else { footEl.replaceChildren(); footEl.classList.add('d-none'); }

  sheetOnClose = onClose;
  backdrop.classList.remove('d-none');
  sheet.classList.remove('d-none');
  requestAnimationFrame(() => {
    backdrop.classList.add('show');
    sheet.classList.add('show');
  });
  document.body.style.overflow = 'hidden';
}

export function closeSheet() {
  const sheet = $('#sheet'), backdrop = $('#sheet-backdrop');
  if (sheet.classList.contains('d-none')) return;
  sheet.classList.remove('show');
  backdrop.classList.remove('show');
  document.body.style.overflow = '';
  setTimeout(() => {
    sheet.classList.add('d-none');
    backdrop.classList.add('d-none');
    $('#sheet-body').replaceChildren();
  }, 260);
  if (sheetOnClose) { const f = sheetOnClose; sheetOnClose = null; f(); }
}

export function initSheet() {
  $('#btn-sheet-close').addEventListener('click', closeSheet);
  $('#sheet-backdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
}

/* ---------------- نافذة التأكيد ---------------- */

/**
 * @param {object} o
 * @param {string} o.title
 * @param {string|Node} o.body
 * @param {string} [o.confirmText]
 * @param {boolean} [o.danger]
 * @param {number} [o.typeNumber] إن مُرِّر، يجب على المستخدم كتابة هذا الرقم للتأكيد
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, body, confirmText = 'تأكيد', danger = true, typeNumber = null }) {
  return new Promise((resolve) => {
    const modalEl = $('#modal');
    $('#modal-title').textContent = title;

    const bodyEl = $('#modal-body');
    bodyEl.replaceChildren();
    if (typeof body === 'string') bodyEl.append(el('p', 'mb-0', body));
    else bodyEl.append(body);

    let input = null;
    if (typeNumber !== null) {
      const wrap = el('div', 'mt-3');
      wrap.append(el('label', 'form-label small fw-semibold',
        `للتأكيد اكتب الرقم <span class="fw-bold text-danger">${typeNumber}</span>`));
      input = el('input', 'form-control text-center fw-bold');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.dir = 'ltr';
      wrap.append(input);
      bodyEl.append(wrap);
    }

    const footer = $('#modal-footer');
    footer.replaceChildren();
    const cancel = el('button', 'btn btn-light', 'إلغاء');
    cancel.type = 'button';
    cancel.setAttribute('data-bs-dismiss', 'modal');
    const okBtn = el('button', `btn ${danger ? 'btn-danger' : 'btn-primary'} fw-bold`, confirmText);
    okBtn.type = 'button';
    if (input) okBtn.disabled = true;
    footer.append(cancel, okBtn);

    if (input) {
      input.addEventListener('input', () => { okBtn.disabled = input.value.trim() !== String(typeNumber); });
    }

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };

    okBtn.addEventListener('click', () => { finish(true); modal.hide(); });
    modalEl.addEventListener('hidden.bs.modal', () => finish(false), { once: true });
    modalEl.addEventListener('shown.bs.modal', () => input && input.focus(), { once: true });
    modal.show();
  });
}

/* ---------------- الإشعارات ---------------- */

const TOAST_STYLE = {
  success: 'text-bg-success',
  error:   'text-bg-danger',
  warn:    'text-bg-warning',
  info:    'text-bg-dark',
};

/**
 * @param {string} message
 * @param {object} [o]
 * @param {'success'|'error'|'warn'|'info'} [o.type]
 * @param {string} [o.actionLabel] نص زر داخل الإشعار (مثل: تراجع)
 * @param {Function} [o.onAction]
 * @param {number} [o.delay]
 */
export function toast(message, { type = 'info', actionLabel = null, onAction = null, delay = 3000 } = {}) {
  const host = $('#toast-host');
  const t = el('div', `toast align-items-center border-0 ${TOAST_STYLE[type] || TOAST_STYLE.info}`);
  t.setAttribute('role', 'alert');

  const row = el('div', 'd-flex align-items-center');
  row.append(el('div', 'toast-body flex-grow-1', esc(message)));

  if (actionLabel && onAction) {
    const b = el('button', 'btn btn-sm btn-light fw-bold mx-2 flex-shrink-0', esc(actionLabel));
    b.type = 'button';
    b.addEventListener('click', () => { bootstrap.Toast.getOrCreateInstance(t).hide(); onAction(); });
    row.append(b);
  }

  const close = el('button', 'btn-close btn-close-white me-2 m-auto flex-shrink-0');
  close.type = 'button';
  close.setAttribute('data-bs-dismiss', 'toast');
  row.append(close);

  t.append(row);
  host.append(t);

  const inst = bootstrap.Toast.getOrCreateInstance(t, { delay, autohide: true });
  t.addEventListener('hidden.bs.toast', () => t.remove());
  inst.show();
  return t;
}

/** يعرض رسالة الخطأ القادمة من الـ API بشكل مفهوم */
export function toastError(e) {
  toast(e?.message || 'حدث خطأ غير متوقع.', { type: 'error', delay: 7000 });
}

/* ---------------- إشعار جاري العمل ---------------- */

let activeProcessingToast = null;
let processingCount = 0;

export function showProcessingToast(message = 'جاري العمل...') {
  processingCount++;
  if (activeProcessingToast) {
    const textEl = $('.toast-body', activeProcessingToast);
    if (textEl) textEl.textContent = message;
    return activeProcessingToast;
  }

  const host = $('#toast-host');
  const t = el('div', 'toast align-items-center border-0 text-bg-primary shadow-lg show fade mb-2');
  t.setAttribute('role', 'status');
  t.setAttribute('aria-live', 'polite');

  const row = el('div', 'd-flex align-items-center py-2 px-3 gap-2');
  row.append(el('span', 'spinner-border spinner-border-sm flex-shrink-0 text-white'));
  row.append(el('div', 'toast-body p-0 text-white fw-bold fs-7', esc(message)));

  t.append(row);
  host.append(t);
  activeProcessingToast = t;
  return t;
}

export function hideProcessingToast() {
  if (processingCount > 0) processingCount--;
  if (processingCount === 0 && activeProcessingToast) {
    const t = activeProcessingToast;
    activeProcessingToast = null;
    t.classList.remove('show');
    setTimeout(() => t.remove(), 200);
  }
}

/* ---------------- أدوات صغيرة ---------------- */

export function setBusy(btn, busy, busyText = 'جاري الحفظ...') {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm ms-2"></span>${busyText}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
}

export function emptyState({ icon = 'bi-inbox-fill', title, text, actionLabel, onAction }) {
  const n = tpl('tpl-empty');
  $('.empty-icon i', n).className = `bi ${icon}`;
  $('.empty-title', n).textContent = title;
  $('.empty-text', n).textContent = text || '';
  const btn = $('.empty-action', n);
  if (actionLabel && onAction) {
    btn.textContent = actionLabel;
    btn.addEventListener('click', onAction);
  } else btn.remove();
  return n;
}

export const fmtTime = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};

export const dayLabel = (iso) => {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return 'اليوم';
  if (diff === 1) return 'أمس';
  return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' });
};
