// تدفّق استيراد الإكسيل: قراءة ← مطابقة الأعمدة عند الحاجة ← تحقق ← معاينة ← رفع

import { $, el, tpl, esc, openSheet, closeSheet, toast, toastError, setBusy } from '../ui.js';
import { parseFile, autoMap, validateRows, IMPORT_FIELDS, downloadSampleTemplate } from '../importer.js';
import { getState, mutate } from '../store.js';
import { api } from '../api.js';
import { undoToast } from './students.js';

export async function openImport(file, afterMutate) {
  let parsed;
  const loading = el('div', 'text-center py-5',
    '<div class="spinner-border text-primary"></div><p class="text-muted small mt-3 mb-0">جاري قراءة الملف...</p>');
  openSheet({ title: 'استيراد من إكسيل', body: loading });

  try {
    parsed = await parseFile(file);
  } catch (e) {
    const errBody = el('div', 'p-2 text-center');
    errBody.append(el('div', 'alert alert-danger mb-3', esc(e.message)));
    const dlBtn = el('button', 'btn btn-outline-success btn-sm rounded-pill fw-bold', '<i class="bi bi-file-earmark-arrow-down-fill ms-1"></i> تنزيل نموذج إكسيل تجريبي');
    dlBtn.type = 'button';
    dlBtn.addEventListener('click', downloadSampleTemplate);
    errBody.append(dlBtn);
    return openSheet({ title: 'تعذّر قراءة الملف', body: errBody });
  }

  const { headers, rows } = parsed;
  if (!rows.length) {
    return openSheet({ title: 'الملف فارغ', body: el('div', 'alert alert-warning', 'لا توجد صفوف بيانات في الملف.') });
  }

  const auto = autoMap(headers);
  if (auto.missing.length || auto.unknown.length) showMapping(headers, rows, auto.mapping, afterMutate);
  else showPreview(rows, auto.mapping, afterMutate);
}

/* ------------------------- مطابقة الأعمدة ------------------------- */

function showMapping(headers, rows, mapping, afterMutate) {
  const draft = { ...mapping };
  const body = el('div');
  body.append(el('div', 'alert alert-info small',
    'لم نتعرف على كل الأعمدة تلقائياً. حدّد أي عمود في ملفك يقابل كل حقل.'));

  IMPORT_FIELDS.forEach((f) => {
    const wrap = el('div', 'mb-2');
    wrap.append(el('label', 'form-label small fw-semibold mb-1',
      `${esc(f.label)}${f.required ? ' <span class="text-danger">*</span>' : ''}`));
    const sel = el('select', 'form-select form-select-sm');
    sel.append(new Option('— لا يوجد —', ''));
    headers.forEach((h, i) => sel.append(new Option(h || `عمود ${i + 1}`, String(i))));
    sel.value = draft[f.key] === undefined ? '' : String(draft[f.key]);
    sel.addEventListener('change', () => {
      if (sel.value === '') delete draft[f.key];
      else draft[f.key] = Number(sel.value);
    });
    wrap.append(sel);
    body.append(wrap);
  });

  const next = el('button', 'btn btn-primary w-100 fw-bold', 'التالي: المعاينة');
  next.type = 'button';
  next.addEventListener('click', () => {
    const missing = IMPORT_FIELDS.filter((f) => f.required && draft[f.key] === undefined);
    if (missing.length) return toast('اربط أولاً: ' + missing.map((m) => m.label).join('، '), { type: 'warn' });
    showPreview(rows, draft, afterMutate);
  });

  openSheet({ title: 'مطابقة الأعمدة', body, footer: next });
}

/* ---------------------------- المعاينة ---------------------------- */

function showPreview(rows, mapping, afterMutate) {
  const { students, teachers } = getState();
  const { valid, invalid } = validateRows(rows, mapping, { students, teachers });

  const body = el('div');
  const summary = el('div', 'row g-2 mb-3 text-center');
  summary.append(
    statCard('صالح', valid.length, 'success'),
    statCard('مرفوض', invalid.length, invalid.length ? 'danger' : 'secondary'),
  );
  body.append(summary);

  if (!teachers.length) {
    body.append(el('div', 'alert alert-warning small',
      'لا يوجد معلمون مسجلون — كل الصفوف سترفض. أضف المعلمين من شاشة "المعلمون" أولاً.'));
  }

  const table = el('table', 'table table-sm align-middle mb-0');
  table.innerHTML = '<thead><tr><th></th><th>الاسم</th><th>الهاتف</th><th>المستوى</th><th>المعلم</th><th>السبب</th></tr></thead>';
  const tbody = el('tbody');

  valid.slice(0, 100).forEach((s) => tbody.append(previewRow(s, null)));
  invalid.slice(0, 100).forEach((r) => tbody.append(previewRow(
    { name: r.name, phone: '', level: '', mentor: '' }, r.reason)));

  table.append(tbody);
  body.append(el('div', 'table-responsive border rounded', '').appendChild(table).parentNode);

  if (valid.length + invalid.length > 200) {
    body.append(el('p', 'text-muted small mt-2 mb-0', 'يُعرض أول 100 من كل نوع فقط — الاستيراد يشمل كل الصفوف الصالحة.'));
  }

  const btn = el('button', 'btn btn-success w-100 fw-bold', `استيراد ${valid.length} طالب`);
  btn.type = 'button';
  btn.disabled = !valid.length;
  btn.addEventListener('click', async () => {
    setBusy(btn, true, 'جاري الاستيراد...');
    try {
      const res = await mutate(() => api.bulkCreate(valid));
      closeSheet();
      afterMutate();
      const skipped = res.skipped?.length ? ` (رفض الخادم ${res.skipped.length})` : '';
      undoToast(`تم استيراد ${res.added_count} طالب${skipped}`, res?.log_id);
    } catch (e) {
      toastError(e);
    } finally { setBusy(btn, false); }
  });

  openSheet({ title: 'معاينة الاستيراد', body, footer: btn });
}

function statCard(label, value, variant) {
  const col = el('div', 'col-6');
  col.append(el('div', `card border-0 bg-${variant}-subtle p-2`,
    `<div class="fw-bold fs-4 text-${variant}-emphasis">${value}</div>
     <div class="small text-muted">${esc(label)}</div>`));
  return col;
}

function previewRow(s, reason) {
  const tr = tpl('tpl-import-row');
  const ok = !reason;
  $('.import-status i', tr).className = ok
    ? 'bi bi-check-circle-fill text-success fs-5'
    : 'bi bi-x-circle-fill text-danger fs-5';
  $('.import-name', tr).textContent = s.name || '—';
  $('.import-phone', tr).textContent = s.phone || '—';
  $('.import-level', tr).textContent = s.level || '—';
  $('.import-mentor', tr).textContent = s.mentor || '—';
  $('.import-reason', tr).textContent = reason || '';
  if (!ok) tr.classList.add('table-danger');
  return tr;
}
