// شاشة الطلاب: الجدول، التسجيل، التعديل والحذف، العمليات الجماعية، وعناصر التحكم الثلاثة

import { $, $$, el, tpl, esc, openSheet, closeSheet, confirmDialog, toast, toastError, setBusy, emptyState }
  from '../ui.js';
import { STUDENT_FIELDS, LEVELS, YEARS, UNI_STATUS, YES_NO, BULK_EDITABLE, opsFor, fieldByKey }
  from '../constants.js';
import { getQuery, setQuery, runQuery, visibleColumns, moveColumn, toggleColumn } from '../query.js';
import { getState, mutate, findStudentByPhone } from '../store.js';
import { api } from '../api.js';
import { waLink, isValidPhone, normPhone } from '../normalize.js';
import { openImport } from './import.js';
import { downloadSampleTemplate } from '../importer.js';

let selected = new Set();
let lastRows = [];
let onAfterMutate = () => {};
let viewMode = localStorage.getItem('students_view_mode') || (window.innerWidth < 576 ? 'card' : 'table');

export function initStudents({ afterMutate }) {
  onAfterMutate = afterMutate;

  $('#students-search').addEventListener('input', (e) => setQuery({ search: e.target.value }));
  $('#btn-filter').addEventListener('click', openFilterSheet);
  $('#btn-columns').addEventListener('click', openColumnsSheet);
  $('#btn-sort').addEventListener('click', openSortSheet);
  $('#btn-view-mode')?.addEventListener('click', toggleViewMode);
  $('#btn-add-student').addEventListener('click', () => openStudentForm(null));
  $('#btn-download-template')?.addEventListener('click', downloadSampleTemplate);
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) openImport(f, onAfterMutate);
  });

  $('#chk-all').addEventListener('change', (e) => {
    if (e.target.checked) lastRows.forEach((r) => selected.add(r.id));
    else selected.clear();
    render();
  });

  $('#btn-bulk-cancel').addEventListener('click', () => { selected.clear(); render(); });
  $('#btn-bulk-edit').addEventListener('click', openBulkEdit);
  $('#btn-bulk-delete').addEventListener('click', doBulkDelete);
}

function toggleViewMode() {
  viewMode = viewMode === 'table' ? 'card' : 'table';
  localStorage.setItem('students_view_mode', viewMode);
  render();
}

/* ------------------------------ الجدول والعرض ------------------------------ */

export function render() {
  const { students } = getState();
  const q = getQuery();
  const rows = runQuery(students, q);
  lastRows = rows;

  // تنظيف التحديد مما لم يعد ظاهراً
  const visibleIds = new Set(rows.map((r) => r.id));
  [...selected].forEach((id) => { if (!visibleIds.has(id)) selected.delete(id); });

  $('#students-search').value = q.search;
  $('#filter-count').textContent = String((q.filters || []).length);
  $('#columns-count').textContent = String(q.columns.filter((c) => c.visible).length);
  const s0 = (q.sort || [])[0];
  $('#sort-label').textContent = s0 ? fieldByKey(STUDENT_FIELDS, s0.field)?.label || '—' : '—';
  $('#students-count').textContent = `عرض ${rows.length} من ${students.length} طالب`;

  const isCard = viewMode === 'card';
  const modeBtn = $('#btn-view-mode');
  if (modeBtn) {
    const modeLabel = $('#view-mode-label');
    const modeIcon = $('#view-mode-icon');
    if (modeLabel) modeLabel.textContent = isCard ? 'جدول' : 'بطاقات';
    if (modeIcon) modeIcon.className = isCard ? 'bi bi-table' : 'bi bi-card-list';
  }

  const tableCard = $('#students-table-card');
  const cardsContainer = $('#students-cards');

  if (isCard) {
    if (tableCard) tableCard.classList.add('d-none');
    if (cardsContainer) {
      cardsContainer.classList.remove('d-none');
      renderCards(rows);
    }
  } else {
    if (cardsContainer) cardsContainer.classList.add('d-none');
    if (tableCard) tableCard.classList.remove('d-none');
    const cols = visibleColumns();
    renderHead(cols);
    renderBody(rows, cols);
  }

  renderBulkBar();
}

function renderHead(cols) {
  const tr = el('tr');
  const th0 = el('th', 'col-sticky-check text-center');
  th0.append($('#chk-all'));
  tr.append(th0);
  cols.forEach((c, i) => {
    const th = el('th', i === 0 ? 'col-sticky-name' : '', esc(c.label));
    th.style.cursor = 'pointer';
    th.title = 'اضغط للترتيب بهذا العمود';
    th.addEventListener('click', () => {
      const cur = (getQuery().sort || [])[0];
      const dir = cur && cur.field === c.key && cur.dir === 'asc' ? 'desc' : 'asc';
      setQuery({ sort: [{ field: c.key, dir }] });
    });
    tr.append(th);
  });
  tr.append(el('th', 'text-center', 'إجراءات'));
  $('#students-thead').replaceChildren(tr);

  const chk = $('#chk-all');
  chk.checked = lastRows.length > 0 && lastRows.every((r) => selected.has(r.id));
  chk.indeterminate = !chk.checked && lastRows.some((r) => selected.has(r.id));
}

function cellText(row, col) {
  const v = row[col.key] ?? '';
  if (col.key === 'created_at' && v) return new Date(v).toLocaleDateString('ar-EG');
  return v || '—';
}

function renderBody(rows, cols) {
  const tbody = $('#students-tbody');
  tbody.replaceChildren();

  if (!rows.length) {
    const td = el('td');
    td.colSpan = cols.length + 2;
    const { students } = getState();
    td.append(emptyState(
      students.length
        ? { icon: 'bi-funnel', title: 'لا نتائج مطابقة', text: 'جرّب تعديل التصفية أو البحث.',
            actionLabel: 'مسح التصفية', onAction: () => setQuery({ filters: [], search: '' }) }
        : { icon: 'bi-people', title: 'لا يوجد طلاب بعد', text: 'ابدأ بتسجيل أول طالب أو استورد ملف إكسيل.',
            actionLabel: 'تسجيل طالب', onAction: () => openStudentForm(null) }
    ));
    tbody.append(el('tr').appendChild(td).parentNode);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const row of rows) {
    const tr = el('tr');
    if (selected.has(row.id)) tr.classList.add('table-active');

    const tdChk = el('td', 'col-sticky-check text-center');
    const chk = el('input', 'form-check-input');
    chk.type = 'checkbox';
    chk.checked = selected.has(row.id);
    chk.addEventListener('change', () => {
      chk.checked ? selected.add(row.id) : selected.delete(row.id);
      render();
    });
    tdChk.append(chk);
    tr.append(tdChk);

    cols.forEach((c, i) => {
      const td = el('td', i === 0 ? 'col-sticky-name' : '');
      if (c.key === 'phone') {
        td.dir = 'ltr';
        td.classList.add('text-start', 'font-monospace');
      }
      if (c.key === 'level') {
        td.append(el('span', 'badge rounded-pill text-bg-primary-subtle text-primary-emphasis', esc(row.level || '—')));
      } else if (c.key === 'enrolled') {
        const yes = row.enrolled === 'نعم';
        td.append(el('span', `badge rounded-pill ${yes ? 'text-bg-success' : 'text-bg-secondary'}`, esc(row.enrolled || '—')));
      } else {
        td.textContent = cellText(row, c);
      }
      tr.append(td);
    });

    const tdAct = el('td', 'text-center text-nowrap');
    tdAct.append(
      iconBtn('bi-pencil-square', 'btn-outline-primary', 'تعديل', () => openStudentForm(row)),
      iconBtn('bi-whatsapp', 'btn-outline-success', 'واتساب', () => window.open(waLink(row.phone), '_blank', 'noopener')),
      iconBtn('bi-trash', 'btn-outline-danger', 'حذف', () => doDelete(row)),
    );
    tr.append(tdAct);
    frag.append(tr);
  }
  tbody.append(frag);
}

/* ----------------------- عرض البطاقات للجوال ----------------------- */

function renderCards(rows) {
  const container = $('#students-cards');
  if (!container) return;
  container.replaceChildren();

  if (!rows.length) {
    const { students } = getState();
    container.append(emptyState(
      students.length
        ? { icon: 'bi-funnel', title: 'لا نتائج مطابقة', text: 'جرّب تعديل التصفية أو البحث.',
            actionLabel: 'مسح التصفية', onAction: () => setQuery({ filters: [], search: '' }) }
        : { icon: 'bi-people', title: 'لا يوجد طلاب بعد', text: 'ابدأ بتسجيل أول طالب أو استورد ملف إكسيل.',
            actionLabel: 'تسجيل طالب', onAction: () => openStudentForm(null) }
    ));
    return;
  }

  const frag = document.createDocumentFragment();
  for (const row of rows) {
    const isSelected = selected.has(row.id);
    const card = el('div', `card border-0 shadow-sm p-3 mb-2 transition-all ${isSelected ? 'border-start border-4 border-primary bg-primary-subtle' : ''}`);

    const top = el('div', 'd-flex align-items-center justify-content-between mb-2 gap-2');
    
    const nameWrap = el('div', 'd-flex align-items-center gap-2 overflow-hidden');
    const chk = el('input', 'form-check-input flex-shrink-0');
    chk.type = 'checkbox';
    chk.checked = isSelected;
    chk.addEventListener('change', () => {
      chk.checked ? selected.add(row.id) : selected.delete(row.id);
      render();
    });

    const name = el('h6', 'fw-bold mb-0 text-truncate', esc(row.name));
    nameWrap.append(chk, name);

    const acts = el('div', 'd-flex align-items-center gap-1 flex-shrink-0');
    acts.append(
      iconBtn('bi-pencil-square', 'btn-outline-primary', 'تعديل', () => openStudentForm(row)),
      iconBtn('bi-whatsapp', 'btn-outline-success', 'واتساب', () => window.open(waLink(row.phone), '_blank', 'noopener')),
      iconBtn('bi-trash', 'btn-outline-danger', 'حذف', () => doDelete(row)),
    );
    top.append(nameWrap, acts);

    const meta = el('div', 'd-flex flex-wrap gap-2 align-items-center text-muted small mt-2 pt-2 border-top border-translucent');

    if (row.phone) {
      const pSpan = el('span', 'font-monospace text-dark d-flex align-items-center gap-1 me-1');
      pSpan.dir = 'ltr';
      pSpan.innerHTML = `<i class="bi bi-telephone-fill text-muted"></i> ${esc(row.phone)}`;
      meta.append(pSpan);
    }

    if (row.level) {
      meta.append(el('span', 'badge rounded-pill text-bg-primary-subtle text-primary-emphasis', `المستوى: ${esc(row.level)}`));
    }

    if (row.mentor) {
      meta.append(el('span', 'badge rounded-pill text-bg-secondary-subtle text-secondary-emphasis', `المعلم: ${esc(row.mentor)}`));
    }

    if (row.uni_status) {
      meta.append(el('span', 'badge rounded-pill text-bg-info-subtle text-info-emphasis', esc(row.uni_status)));
    }

    if (row.enrolled === 'نعم') {
      meta.append(el('span', 'badge rounded-pill text-bg-success-subtle text-success-emphasis', `معهد: ${esc(row.year || 'مسجل')}`));
    }

    card.append(top, meta);
    frag.append(card);
  }

  container.append(frag);
}

function iconBtn(icon, variant, title, onClick) {
  const b = el('button', `btn btn-sm ${variant} border-0 mx-1`, `<i class="bi ${icon}"></i>`);
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
}

function renderBulkBar() {
  const bar = $('#bulk-bar');
  $('#bulk-count').textContent = `${selected.size} محدد`;
  bar.classList.toggle('show', selected.size > 0);
}

/* --------------------------- نموذج الطالب --------------------------- */

export function openStudentForm(row) {
  const form = tpl('tpl-student-form');
  const { teachers } = getState();

  const mentorSel = $('[name="mentor"]', form);
  mentorSel.replaceChildren(new Option('اختر المعلم (اختياري)...', ''));
  teachers.forEach((t) => mentorSel.append(new Option(t.name, t.name)));

  if (!teachers.length) {
    const a = $('.form-alert', form);
    a.classList.remove('d-none', 'alert-danger');
    a.classList.add('alert-warning');
    a.textContent = 'لا يوجد معلمون مسجلون بعد. أضف معلماً من شاشة "المعلمون" أولاً.';
  }

  const yearWrap = $('.institute-year-group', form) || $('[name="year"]', form)?.closest('.mb-3, .col-12, .col-6, div');
  const enrolledInputs = $$('[name="enrolled"]', form);
  const levelSel = $('[name="level"]', form);
  const hint = $('.level-teacher-hint', form);

  const syncYear = () => {
    const yes = enrolledValue(form) === 'نعم';
    if (yearWrap) yearWrap.classList.toggle('d-none', !yes);
    if (!yes) {
      const yearInputs = $$('[name="year"]', form);
      yearInputs.forEach((i) => {
        if (i.type === 'radio' || i.type === 'checkbox') i.checked = false;
        else i.value = '';
      });
    }
  };
  const syncHint = () => hint?.classList.toggle('d-none', levelSel.value !== 'معلم');

  enrolledInputs.forEach((i) => i.addEventListener('change', syncYear));
  levelSel.addEventListener('change', syncHint);

  if (row) {
    $('[name="name"]', form).value = row.name || '';
    $('[name="phone"]', form).value = row.phone || '';
    levelSel.value = row.level || '';
    mentorSel.value = row.mentor || '';
    setRadioOrSelect(form, 'uni_status', row.uni_status || 'طالب');
    setRadioOrSelect(form, 'enrolled', row.enrolled || 'لا');
    setRadioOrSelect(form, 'year', row.year || '');
    const n = $('[name="notes"]', form);
    if (n) n.value = row.notes || '';
  }
  syncYear();
  syncHint();

  const submit = $('[type="submit"]', form) || el('button', 'btn btn-primary w-100', 'حفظ');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const alert = $('.form-alert', form);
    const fail = (m) => {
      alert.className = 'form-alert alert alert-danger mb-3';
      alert.textContent = m;
      alert.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };

    const data = {
      name:       $('[name="name"]', form).value.trim(),
      phone:      normPhone($('[name="phone"]', form).value),
      level:      levelSel.value,
      mentor:     mentorSel.value,
      uni_status: readValue(form, 'uni_status'),
      enrolled:   enrolledValue(form),
      year:       readValue(form, 'year'),
      notes:      $('[name="notes"]', form)?.value.trim() || '',
    };

    if (data.name.length < 2)        return fail('الاسم مطلوب (حرفان على الأقل).');
    if (!isValidPhone(data.phone))   return fail('رقم الهاتف غير صالح. المتوقع 11 رقماً يبدأ بـ 01.');
    if (!data.level)                 return fail('اختر المستوى.');
    if (data.enrolled === 'نعم' && !data.year) return fail('تحديد المستوى / السنة بالمعهد مطلوب لأن الطالب مسجل بالمعهد.');
    if (data.enrolled === 'لا') data.year = '';

    const dup = findStudentByPhone(data.phone, row?.id || null);
    if (dup) return fail(`هذا الرقم مسجل بالفعل للطالب: ${dup.name}`);

    setBusy(submit, true);
    try {
      const res = await mutate(() => row
        ? api.update({ ...data, id: row.id, expected_updated_at: row.updated_at })
        : api.create(data));
      closeSheet();
      onAfterMutate();
      undoToast(row ? 'تم تعديل بيانات الطالب' : 'تمت إضافة الطالب', res?.log_id);
    } catch (err) {
      fail(err.message);
    } finally {
      setBusy(submit, false);
    }
  });

  openSheet({ title: row ? 'تعديل بيانات طالب' : 'تسجيل طالب جديد', body: form });
}

const readValue = (form, name) => {
  const radios = $$(`[name="${name}"]`, form);
  if (radios.length && radios[0].type === 'radio') return radios.find((r) => r.checked)?.value || '';
  return radios[0]?.value || '';
};
const enrolledValue = (form) => readValue(form, 'enrolled');

function setRadioOrSelect(form, name, value) {
  const nodes = $$(`[name="${name}"]`, form);
  if (!nodes.length) return;
  if (nodes[0].type === 'radio' || nodes[0].type === 'checkbox') {
    nodes.forEach((n) => { n.checked = n.value === value; });
  } else nodes[0].value = value;
}

/* ------------------------------ الحذف ------------------------------ */

async function doDelete(row) {
  const okGo = await confirmDialog({
    title: 'حذف طالب',
    body: `سيتم نقل "${row.name}" إلى الأرشيف. يمكنك استرجاعه لاحقاً من شاشة السجل.`,
    confirmText: 'حذف',
  });
  if (!okGo) return;
  try {
    const res = await mutate(() => api.remove(row.id, row.updated_at));
    onAfterMutate();
    undoToast(`تم حذف ${row.name}`, res?.log_id);
  } catch (e) { toastError(e); }
}

async function doBulkDelete() {
  const ids = [...selected];
  if (!ids.length) return;
  const okGo = await confirmDialog({
    title: 'حذف جماعي',
    body: `سيتم نقل ${ids.length} طالب إلى الأرشيف.`,
    confirmText: 'حذف الكل',
    typeNumber: ids.length,
  });
  if (!okGo) return;
  try {
    const res = await mutate(() => api.bulkDelete(ids));
    selected.clear();
    onAfterMutate();
    if (res.blocked?.length) {
      toast(`تم حذف ${res.deleted_count} — تعذّر حذف ${res.blocked.length}: ${res.blocked[0].reason}`,
        { type: 'warn', delay: 9000 });
    } else {
      undoToast(`تم حذف ${res.deleted_count} طالب`, res?.log_id);
    }
  } catch (e) { toastError(e); }
}

/* --------------------------- تعديل جماعي --------------------------- */

function openBulkEdit() {
  const ids = [...selected];
  const body = el('div');
  body.append(el('p', 'text-muted small',
    `سيتم تطبيق التغيير على <span class="fw-bold text-body">${ids.length}</span> طالب.`));

  const fieldSel = el('select', 'form-select mb-3');
  BULK_EDITABLE.forEach((k) => fieldSel.append(new Option(fieldByKey(STUDENT_FIELDS, k).label, k)));
  body.append(el('label', 'form-label fw-semibold', 'الحقل المراد تعديله'), fieldSel);

  const valWrap = el('div', 'mb-3');
  body.append(el('label', 'form-label fw-semibold', 'القيمة الجديدة'), valWrap);

  const buildValue = () => {
    const def = fieldByKey(STUDENT_FIELDS, fieldSel.value);
    const sel = el('select', 'form-select');
    const opts = def.key === 'mentor' ? getState().teachers.map((t) => t.name) : (def.options || []);
    if (def.key === 'year') sel.append(new Option('(بدون سنة)', ''));
    opts.forEach((o) => sel.append(new Option(o, o)));
    valWrap.replaceChildren(sel);
  };
  fieldSel.addEventListener('change', buildValue);
  buildValue();

  const btn = el('button', 'btn btn-primary w-100 fw-bold', 'تطبيق على المحددين');
  btn.type = 'button';
  btn.addEventListener('click', async () => {
    const field = fieldSel.value;
    const value = $('select', valWrap).value;
    setBusy(btn, true, 'جاري التطبيق...');
    try {
      const res = await mutate(() => api.bulkUpdate(ids, field, value));
      closeSheet();
      selected.clear();
      onAfterMutate();
      if (res.failed?.length) {
        toast(`تم تعديل ${res.updated_count} — استُثني ${res.failed.length}: ${res.failed[0].reason}`,
          { type: 'warn', delay: 9000 });
      } else {
        undoToast(`تم تعديل ${res.updated_count} طالب`, res?.log_id);
      }
    } catch (e) {
      toastError(e);
    } finally { setBusy(btn, false); }
  });

  openSheet({ title: 'تعديل جماعي', body, footer: btn });
}

/* --------------------------- التصفية --------------------------- */

function valueControl(fieldKey, value, onChange) {
  const def = fieldByKey(STUDENT_FIELDS, fieldKey);
  const opts = def?.key === 'mentor'
    ? getState().teachers.map((t) => t.name)
    : (def?.options || []);

  if (opts.length) {
    const currentSelected = new Set(Array.isArray(value) ? value : (value ? [value] : []));
    const container = el('div', 'd-flex flex-wrap gap-1 mt-1 p-2 bg-body-tertiary rounded border');

    const updatePills = () => {
      container.replaceChildren();
      opts.forEach((opt) => {
        const isChecked = currentSelected.has(opt);
        const chip = el('button', `btn btn-sm ${isChecked ? 'btn-primary fw-bold' : 'btn-outline-secondary'} rounded-pill flex-shrink-0 fs-8 py-1 px-2 mb-1`);
        chip.type = 'button';
        chip.innerHTML = `${isChecked ? '<i class="bi bi-check-lg ms-1"></i>' : ''}${esc(opt)}`;

        chip.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (currentSelected.has(opt)) {
            currentSelected.delete(opt);
          } else {
            currentSelected.add(opt);
          }
          const newArr = Array.from(currentSelected);
          onChange(newArr);
          updatePills();
        });

        container.append(chip);
      });

      if (currentSelected.size > 0) {
        const clearWrap = el('div', 'w-100 text-end border-top pt-1 mt-1');
        const clearBtn = el('button', 'btn btn-link text-danger text-decoration-none fs-8 p-0 me-1', 'مسح التحديد');
        clearBtn.type = 'button';
        clearBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          currentSelected.clear();
          onChange([]);
          updatePills();
        });
        clearWrap.append(clearBtn);
        container.append(clearWrap);
      }
    };

    updatePills();
    return container;
  }

  const inp = el('input', 'form-control form-control-sm');
  inp.type = 'text';
  inp.placeholder = 'القيمة...';
  inp.value = Array.isArray(value) ? value.join(', ') : (value || '');
  inp.addEventListener('input', () => onChange(inp.value));
  return inp;
}

export function openFilterSheet() {
  const draft = (getQuery().filters || []).map((f) => ({ ...f }));
  const body = el('div');
  const list = el('div');
  body.append(list);

  const addBtn = el('button', 'btn btn-outline-primary w-100 mt-2', '<i class="bi bi-plus-lg"></i> إضافة شرط آخر');
  addBtn.type = 'button';
  addBtn.addEventListener('click', () => { draft.push({ field: 'name', op: 'contains', value: '' }); paint(); });
  body.append(addBtn);

  function paint() {
    list.replaceChildren();
    draft.forEach((f, idx) => {
      const rowEl = tpl('tpl-filter-row');
      const fieldSel = $('[name="field"]', rowEl);
      fieldSel.replaceChildren();
      STUDENT_FIELDS.filter((x) => x.type !== 'date')
        .forEach((x) => fieldSel.append(new Option(x.label, x.key)));
      fieldSel.value = f.field;

      const opSel = $('[name="op"]', rowEl);
      const paintOps = () => {
        const def = fieldByKey(STUDENT_FIELDS, f.field);
        opSel.replaceChildren();
        opsFor(def?.type || 'text').forEach((o) => opSel.append(new Option(o.label, o.key)));
        if (!opsFor(def?.type || 'text').some((o) => o.key === f.op)) f.op = opSel.options[0].value;
        opSel.value = f.op;
      };
      paintOps();

      const valBox = $('.filter-value', rowEl);
      const paintVal = () => {
        const noValue = ['isEmpty', 'notEmpty'].includes(f.op);
        valBox.classList.toggle('d-none', noValue);
        if (!noValue) valBox.replaceChildren(valueControl(f.field, f.value, (v) => { f.value = v; }));
      };
      paintVal();

      fieldSel.addEventListener('change', () => { f.field = fieldSel.value; f.value = []; paintOps(); paintVal(); });
      opSel.addEventListener('change', () => { f.op = opSel.value; paintVal(); });
      $('.btn-remove', rowEl).addEventListener('click', () => { draft.splice(idx, 1); paint(); });

      list.append(rowEl);
    });

    if (!draft.length) list.append(el('p', 'text-muted small text-center py-3', 'لا توجد شروط تصفية.'));
  }
  paint();

  const footer = el('div', 'd-flex gap-2');
  const reset = el('button', 'btn btn-light flex-fill', 'إعادة ضبط');
  reset.type = 'button';
  reset.addEventListener('click', () => { setQuery({ filters: [] }); closeSheet(); });
  const apply = el('button', 'btn btn-primary flex-fill fw-bold', 'تطبيق');
  apply.type = 'button';
  apply.addEventListener('click', () => {
    setQuery({
      filters: draft.filter((f) =>
        ['isEmpty', 'notEmpty'].includes(f.op) ||
        (Array.isArray(f.value) ? f.value.length > 0 : String(f.value).trim() !== '')
      ),
    });
    closeSheet();
  });
  footer.append(reset, apply);

  openSheet({ title: 'تصفية الطلاب', body, footer });
}

/* --------------------------- الأعمدة --------------------------- */

function openColumnsSheet() {
  const body = el('div');
  const paint = () => {
    body.replaceChildren();
    [...getQuery().columns].sort((a, b) => a.order - b.order).forEach((c, i, arr) => {
      const def = fieldByKey(STUDENT_FIELDS, c.field);
      const rowEl = tpl('tpl-column-row');
      const id = 'colsw-' + c.field;
      const sw = $('[name="visible"]', rowEl);
      sw.id = id;
      sw.checked = c.visible;
      const lbl = $('.col-label', rowEl);
      lbl.htmlFor = id;
      lbl.textContent = def?.label || c.field;
      sw.addEventListener('change', () => { toggleColumn(c.field); paint(); });
      const up = $('.btn-up', rowEl), down = $('.btn-down', rowEl);
      up.disabled = i === 0;
      down.disabled = i === arr.length - 1;
      up.addEventListener('click', () => { moveColumn(c.field, -1); paint(); });
      down.addEventListener('click', () => { moveColumn(c.field, 1); paint(); });
      body.append(rowEl);
    });
  };
  paint();

  const done = el('button', 'btn btn-primary w-100 fw-bold', 'تم');
  done.type = 'button';
  done.addEventListener('click', closeSheet);
  openSheet({ title: 'الأعمدة وترتيبها', body, footer: done });
}

/* --------------------------- الترتيب --------------------------- */

export function openSortSheet() {
  const draft = (getQuery().sort || []).map((s) => ({ ...s }));
  if (!draft.length) draft.push({ field: 'name', dir: 'asc' });

  const body = el('div');
  const list = el('div');
  const addBtn = el('button', 'btn btn-outline-primary w-100 mt-2', '<i class="bi bi-plus-lg"></i> إضافة مستوى ترتيب');
  addBtn.type = 'button';
  addBtn.addEventListener('click', () => { draft.push({ field: 'name', dir: 'asc' }); paint(); });
  body.append(list, addBtn);

  function paint() {
    list.replaceChildren();
    draft.forEach((s, idx) => {
      const rowEl = tpl('tpl-sort-row');
      const sel = $('[name="field"]', rowEl);
      sel.replaceChildren();
      STUDENT_FIELDS.forEach((f) => sel.append(new Option(f.label, f.key)));
      sel.value = s.field;
      sel.addEventListener('change', () => { s.field = sel.value; });

      const dirBtn = $('.btn-dir', rowEl);
      const paintDir = () => {
        dirBtn.dataset.dir = s.dir;
        dirBtn.innerHTML = s.dir === 'asc'
          ? 'تصاعدي <i class="bi bi-sort-down"></i>'
          : 'تنازلي <i class="bi bi-sort-up"></i>';
      };
      paintDir();
      dirBtn.addEventListener('click', () => { s.dir = s.dir === 'asc' ? 'desc' : 'asc'; paintDir(); });

      if (draft.length > 1) {
        const rm = el('button', 'btn btn-sm btn-outline-danger border-0', '<i class="bi bi-x-lg"></i>');
        rm.type = 'button';
        rm.addEventListener('click', () => { draft.splice(idx, 1); paint(); });
        rowEl.append(rm);
      }
      list.append(rowEl);
    });
  }
  paint();

  const apply = el('button', 'btn btn-primary w-100 fw-bold', 'تطبيق');
  apply.type = 'button';
  apply.addEventListener('click', () => { setQuery({ sort: draft }); closeSheet(); });
  openSheet({ title: 'ترتيب الطلاب', body, footer: apply });
}

/* --------------------------- إشعار التراجع --------------------------- */

export function undoToast(message, logId) {
  if (!logId) return toast(message, { type: 'success', delay: 3000 });
  toast(message, {
    type: 'success',
    delay: 3000,
    actionLabel: 'تراجع',
    onAction: async () => {
      try {
        const res = await mutate(() => api.undo(logId));
        onAfterMutate();
        toast(res.message || 'تم التراجع', { type: 'info', delay: 3000 });
      } catch (e) { toastError(e); }
    },
  });
}
