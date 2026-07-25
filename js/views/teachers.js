// شاشة المعلمين — مصدر قائمة "المعلم المتابع" في كل التطبيق

import { $, el, tpl, esc, openSheet, closeSheet, confirmDialog, toast, toastError, setBusy, emptyState }
  from '../ui.js';
import { getState, mutate, teachersWithCounts } from '../store.js';
import { api } from '../api.js';
import { waLink, isValidPhone, normPhone, compareText } from '../normalize.js';
import { setQuery } from '../query.js';
import { undoToast } from './students.js';

let onAfterMutate = () => {};
let goToStudents = () => {};
let currentSort = { field: 'name', dir: 'asc' };

const TEACHER_COLUMNS = [
  { key: 'name',    label: 'الاسم',          sortable: true },
  { key: 'phone',   label: 'رقم الهاتف',     sortable: true },
  { key: 'source',  label: 'المصدر',         sortable: true },
  { key: 'mentees', label: 'عدد المتابعين', sortable: true },
  { key: 'actions', label: 'إجراءات',       sortable: false },
];

export function initTeachers({ afterMutate, navigate }) {
  onAfterMutate = afterMutate;
  goToStudents = navigate;
  $('#btn-add-teacher').addEventListener('click', () => openTeacherForm(null));
}

export function render() {
  const allRows = teachersWithCounts();
  const rows = allRows.sort((a, b) => {
    const dir = currentSort.dir === 'asc' ? 1 : -1;
    if (currentSort.field === 'name') return compareText(a.name, b.name) * dir;
    if (currentSort.field === 'phone') return compareText(a.phone || '', b.phone || '') * dir;
    if (currentSort.field === 'source') return compareText(a.source || '', b.source || '') * dir;
    if (currentSort.field === 'mentees') return ((a.mentees || 0) - (b.mentees || 0)) * dir;
    return 0;
  });

  $('#teachers-count').textContent = `عرض ${rows.length} معلم`;

  const head = el('tr');
  TEACHER_COLUMNS.forEach((col, i) => {
    const isFirst = i === 0;
    const isActions = col.key === 'actions';
    const th = el('th', `${isFirst ? 'col-sticky-name' : ''} ${isActions ? 'text-center' : ''}`);

    if (col.sortable) {
      th.style.cursor = 'pointer';
      th.title = 'اضغط للترتيب بهذا العمود';
      const active = currentSort.field === col.key;

      const titleSpan = el('span', 'me-1', col.label);
      let iconClass = 'bi bi-arrow-down-up opacity-25 ms-1 small';
      if (active) {
        if (col.key === 'mentees') {
          iconClass = currentSort.dir === 'asc'
            ? 'bi bi-sort-numeric-down text-primary fw-bold ms-1'
            : 'bi bi-sort-numeric-up-alt text-primary fw-bold ms-1';
        } else {
          iconClass = currentSort.dir === 'asc'
            ? 'bi bi-sort-alpha-down text-primary fw-bold ms-1'
            : 'bi bi-sort-alpha-up-alt text-primary fw-bold ms-1';
        }
      }

      const icon = el('i', iconClass);
      th.append(titleSpan, icon);

      th.addEventListener('click', () => {
        if (currentSort.field === col.key) {
          currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          currentSort.field = col.key;
          currentSort.dir = 'asc';
        }
        render();
      });
    } else {
      th.textContent = col.label;
    }

    head.append(th);
  });
  $('#teachers-thead').replaceChildren(head);

  const tbody = $('#teachers-tbody');
  tbody.replaceChildren();

  if (!rows.length) {
    const td = el('td');
    td.colSpan = 5;
    td.append(emptyState({
      icon: 'bi-person-badge',
      title: 'لا يوجد معلمون بعد',
      text: 'أضف المعلمين أولاً — كل طالب يحتاج معلماً متابعاً عند التسجيل.',
      actionLabel: 'إضافة معلم',
      onAction: () => openTeacherForm(null),
    }));
    const tr = el('tr');
    tr.append(td);
    tbody.append(tr);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const t of rows) {
    const tr = el('tr');
    tr.append(el('td', 'col-sticky-name fw-semibold', esc(t.name)));

    const tdPhone = el('td', 'text-start font-monospace');
    tdPhone.dir = 'ltr';
    tdPhone.textContent = t.phone || '—';
    tr.append(tdPhone);

    const auto = t.source === 'تلقائي';
    const tdSrc = el('td');
    tdSrc.append(el('span', `badge rounded-pill ${auto ? 'text-bg-success' : 'text-bg-primary'}`, esc(t.source)));
    tr.append(tdSrc);

    const tdCount = el('td');
    const link = el('button', 'btn btn-sm btn-link p-0 fw-bold text-decoration-none', String(t.mentees));
    link.type = 'button';
    link.title = 'عرض طلاب هذا المعلم';
    link.addEventListener('click', () => {
      setQuery({ filters: [{ field: 'mentor', op: 'equals', value: t.name }], search: '' });
      goToStudents('students');
    });
    tdCount.append(link, el('span', 'text-muted small ms-1', 'طالب'));
    tr.append(tdCount);

    const tdAct = el('td', 'text-center text-nowrap');
    tdAct.append(
      iconBtn('bi-pencil-square', 'btn-outline-primary', 'تعديل', () => openTeacherForm(t)),
      iconBtn('bi-whatsapp', 'btn-outline-success', 'واتساب', () => window.open(waLink(t.phone), '_blank', 'noopener')),
      iconBtn('bi-trash', 'btn-outline-danger', 'حذف', () => doDelete(t)),
    );
    tr.append(tdAct);
    frag.append(tr);
  }
  tbody.append(frag);
}

function iconBtn(icon, variant, title, onClick) {
  const b = el('button', `btn btn-sm ${variant} border-0 mx-1`, `<i class="bi ${icon}"></i>`);
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
}

function openTeacherForm(row) {
  const form = tpl('tpl-teacher-form');
  if (row) {
    $('[name="name"]', form).value = row.name || '';
    $('[name="phone"]', form).value = row.phone || '';
    const n = $('[name="notes"]', form);
    if (n) n.value = row.notes || '';
    if (row.source === 'تلقائي') {
      const a = $('.form-alert', form);
      a.className = 'form-alert alert alert-info mb-3';
      a.textContent = 'هذا المعلم مرتبط بطالب مستواه (معلم). تعديل الاسم هنا سيحدّث سجل الطالب وكل طلابه أيضاً.';
    }
  }

  const submit = $('[type="submit"]', form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const alert = $('.form-alert', form);
    const fail = (m) => { alert.className = 'form-alert alert alert-danger mb-3'; alert.textContent = m; };

    const data = {
      name: $('[name="name"]', form).value.trim(),
      phone: normPhone($('[name="phone"]', form).value),
      notes: $('[name="notes"]', form)?.value.trim() || '',
    };
    if (data.name.length < 2) return fail('اسم المعلم مطلوب.');
    if (!isValidPhone(data.phone)) return fail('رقم الهاتف غير صالح. المتوقع 11 رقماً يبدأ بـ 01.');

    setBusy(submit, true);
    try {
      const res = await mutate(() => row
        ? api.updateTeacher({ ...data, id: row.id, expected_updated_at: row.updated_at })
        : api.createTeacher(data));
      closeSheet();
      onAfterMutate();
      const extra = res?.cascaded ? ` (تم تحديث ${res.cascaded} طالب)` : '';
      undoToast((row ? 'تم تعديل المعلم' : 'تمت إضافة المعلم') + extra, res?.log_id);
    } catch (err) {
      fail(err.message);
    } finally { setBusy(submit, false); }
  });

  openSheet({ title: row ? 'تعديل معلم' : 'إضافة معلم', body: form });
}

async function doDelete(t) {
  if (t.mentees > 0) {
    return offerReassign(t);
  }
  const okGo = await confirmDialog({
    title: 'حذف معلم',
    body: `سيتم نقل "${t.name}" إلى الأرشيف.`,
    confirmText: 'حذف',
  });
  if (!okGo) return;
  try {
    const res = await mutate(() => api.deleteTeacher(t.id));
    onAfterMutate();
    undoToast(`تم حذف ${t.name}`, res?.log_id);
  } catch (e) { toastError(e); }
}

/** المعلم متابع لطلاب — نعرض النقل لمعلم آخر بدل الرفض الجاف */
function offerReassign(t) {
  const { students, teachers } = getState();
  const mine = students.filter((s) => s.mentor === t.name);
  const others = teachers.filter((x) => x.id !== t.id);

  const body = el('div');
  body.append(el('div', 'alert alert-warning',
    `<strong>${esc(t.name)}</strong> متابع لـ <strong>${mine.length}</strong> طالب، فلا يمكن حذفه قبل نقلهم.`));

  const ul = el('ul', 'list-group list-group-flush mb-3');
  mine.slice(0, 8).forEach((s) => ul.append(el('li', 'list-group-item px-0 py-1 small', esc(s.name))));
  if (mine.length > 8) ul.append(el('li', 'list-group-item px-0 py-1 small text-muted', `و${mine.length - 8} آخرين...`));
  body.append(ul);

  if (!others.length) {
    body.append(el('p', 'text-muted small', 'لا يوجد معلم آخر لنقل الطلاب إليه. أضف معلماً جديداً أولاً.'));
    return openSheet({ title: 'تعذّر الحذف', body });
  }

  body.append(el('label', 'form-label fw-semibold', 'انقل طلابه إلى:'));
  const sel = el('select', 'form-select mb-3');
  others.forEach((o) => sel.append(new Option(o.name, o.name)));
  body.append(sel);

  const btn = el('button', 'btn btn-danger w-100 fw-bold', 'نقل الطلاب ثم حذف المعلم');
  btn.type = 'button';
  btn.addEventListener('click', async () => {
    setBusy(btn, true, 'جاري النقل...');
    try {
      await mutate(() => api.bulkUpdate(mine.map((s) => s.id), 'mentor', sel.value));
      const res = await mutate(() => api.deleteTeacher(t.id));
      closeSheet();
      onAfterMutate();
      toast(`تم نقل ${mine.length} طالب إلى ${sel.value} وحذف ${t.name}`, { type: 'success', delay: 3000 });
      void res;
    } catch (e) {
      toastError(e);
    } finally { setBusy(btn, false); }
  });

  openSheet({ title: 'المعلم متابع لطلاب', body, footer: btn });
}
