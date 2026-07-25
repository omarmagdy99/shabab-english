import { $, el, toast } from '../ui.js';
import { LS } from '../config.js';
import { getState, mutate, subscribe } from '../store.js';
import { api } from '../api.js';
import { getQuery, setQuery, runQuery } from '../query.js';
import { renderTemplate, DEFAULT_TEMPLATE, CHIPS } from '../template.js';
import { STUDENT_FIELDS, fieldByKey } from '../constants.js';
import { openFilterSheet, openSortSheet } from './students.js';

const load = () => {
  try { return JSON.parse(localStorage.getItem(LS.templates)) || {}; }
  catch { return {}; }
};
const save = (o) => localStorage.setItem(LS.templates, JSON.stringify(o));

let store = load();
if (!store.__current) store.__current = DEFAULT_TEMPLATE;

export function initMessages() {
  const editor = $('#tpl-editor');
  editor.value = store.__current;

  buildChips();
  buildSelect();
  subscribe(() => buildSelect($('#tpl-select')?.value));

  const searchInput = $('#msg-search');
  if (searchInput) {
    searchInput.value = getQuery().search || '';
    searchInput.addEventListener('input', (e) => {
      setQuery({ search: e.target.value });
    });
  }

  $('#btn-msg-filter')?.addEventListener('click', openFilterSheet);
  $('#btn-msg-sort')?.addEventListener('click', openSortSheet);
  $('#btn-msg-clear')?.addEventListener('click', () => {
    setQuery({ filters: [], search: '' });
  });

  editor.addEventListener('input', () => {
    store.__current = editor.value;
    save(store);
    render();
  });

  $('#btn-copy').addEventListener('click', copyOutput);
  $('#btn-reset-tpl').addEventListener('click', () => {
    editor.value = DEFAULT_TEMPLATE;
    store.__current = DEFAULT_TEMPLATE;
    save(store);
    render();
    toast('تمت استعادة القالب الافتراضي', { type: 'info' });
  });

  $('#btn-save-tpl').addEventListener('click', async () => {
    const name = prompt('اسم القالب:');
    if (!name || !name.trim()) return;
    const currentQuery = getQuery();
    const qObj = {
      filters: (currentQuery.filters || []).map((f) => ({ ...f })),
      search: currentQuery.search || '',
      sort: (currentQuery.sort || []).map((s) => ({ ...s })),
    };
    store[name.trim()] = { text: editor.value, query: qObj };
    save(store);

    try {
      await mutate(() => api.saveTemplate(name.trim(), editor.value, qObj));
      toast(`تم حفظ القالب والفلتر في Google Sheets: ${name.trim()}`, { type: 'success' });
    } catch {
      toast(`تم حفظ القالب محلياً: ${name.trim()}`, { type: 'info' });
    }
    buildSelect(name.trim());
  });

  $('#btn-delete-tpl').addEventListener('click', async () => {
    const selName = $('#tpl-select').value;
    if (!selName) return toast('اختر قالباً لحذفه أولاً', { type: 'warn' });
    if (!confirm(`هل أنت تأكد من حذف القالب "${selName}"؟`)) return;

    delete store[selName];
    save(store);

    try {
      await mutate(() => api.deleteTemplate(selName));
      toast(`تم حذف القالب من Google Sheets: ${selName}`, { type: 'success' });
    } catch {
      toast(`تم حذف القالب: ${selName}`, { type: 'info' });
    }

    editor.value = DEFAULT_TEMPLATE;
    store.__current = DEFAULT_TEMPLATE;
    save(store);
    buildSelect('');
    render();
  });

  $('#tpl-select').addEventListener('change', (e) => {
    const name = e.target.value;
    if (!name) {
      editor.value = DEFAULT_TEMPLATE;
      store.__current = editor.value;
      save(store);
      render();
      return;
    }

    // ابحث في Google Sheets أولاً ثم الكاش المحلي
    const remote = (getState().templates || []).find((t) => t.name === name);
    let item = store[name];
    if (remote) {
      let parsedQuery = null;
      try { parsedQuery = JSON.parse(remote.query_json); } catch { /* ignore */ }
      item = { text: remote.content, query: parsedQuery };
    }

    if (!item) return;

    if (typeof item === 'string') {
      editor.value = item;
    } else {
      editor.value = item.text || DEFAULT_TEMPLATE;
      if (item.query) {
        setQuery({
          filters: (item.query.filters || []).map((f) => ({ ...f })),
          search: item.query.search || '',
          sort: (item.query.sort || []).map((s) => ({ ...s })),
        });
      }
    }
    store.__current = editor.value;
    save(store);
    render();
    toast(`تم تطبيق القالب والفلتر: ${name}`, { type: 'info', delay: 2000 });
  });
}

function buildChips() {
  const host = $('#tpl-chips');
  host.replaceChildren();
  CHIPS.forEach((c) => {
    const b = el('button', 'btn btn-sm btn-outline-secondary rounded-pill flex-shrink-0', c.label);
    b.type = 'button';
    b.addEventListener('click', () => insertAtCursor(c.insert));
    host.append(b);
  });
}

function buildSelect(selectedName = '') {
  const sel = $('#tpl-select');
  const curr = sel.value || selectedName;
  sel.replaceChildren(new Option('القالب الافتراضي', ''));

  const names = new Set([
    ...Object.keys(store).filter((k) => k !== '__current'),
    ...(getState().templates || []).map((t) => t.name),
  ]);

  names.forEach((k) => sel.append(new Option(k, k)));
  sel.value = names.has(curr) ? curr : (names.has(selectedName) ? selectedName : '');
}

function insertAtCursor(text) {
  const ta = $('#tpl-editor');
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  const pos = start + text.length;
  ta.setSelectionRange(pos, pos);
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

export function render() {
  const q = getQuery();
  const rows = runQuery(getState().students, q);
  const out = renderTemplate($('#tpl-editor').value || DEFAULT_TEMPLATE, rows);
  $('#msg-output').value = out;
  $('#msg-count').textContent = `توليد نص لـ ${rows.length} طالب ضمن التصفية الحالية`;

  const searchInput = $('#msg-search');
  if (searchInput && searchInput.value !== (q.search || '')) {
    searchInput.value = q.search || '';
  }

  const filterCountEl = $('#msg-filter-count');
  if (filterCountEl) {
    filterCountEl.textContent = q.filters ? q.filters.length : 0;
  }

  const sortLabelEl = $('#msg-sort-label');
  if (sortLabelEl) {
    const s = q.sort ? q.sort[0] : null;
    const def = fieldByKey(STUDENT_FIELDS, s?.field);
    sortLabelEl.textContent = def ? def.label : 'المستوى';
  }
}

async function copyOutput() {
  const text = $('#msg-output').value;
  if (!text.trim()) return toast('لا يوجد نص لنسخه', { type: 'warn' });
  try {
    await navigator.clipboard.writeText(text);
    toast('تم نسخ النص بنجاح', { type: 'success' });
  } catch {
    // بديل للمتصفحات القديمة أو سياق غير آمن
    const ta = $('#msg-output');
    ta.removeAttribute('readonly');
    ta.select();
    const ok = document.execCommand?.('copy');
    ta.setAttribute('readonly', '');
    window.getSelection()?.removeAllRanges();
    toast(ok ? 'تم نسخ النص بنجاح' : 'تعذّر النسخ تلقائياً — حدد النص وانسخه يدوياً',
      { type: ok ? 'success' : 'warn' });
  }
}
