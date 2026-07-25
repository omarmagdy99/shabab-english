// محرك الاستعلام الموحد — نسخة واحدة تشترك فيها شاشة الطلاب وشاشة الرسائل.
// أي تغيير في الفلتر أو الترتيب ينعكس على الشاشتين فوراً.

import { LS } from './config.js';
import { STUDENT_FIELDS, LEVEL_RANK, RANK_FALLBACK, fieldByKey } from './constants.js';
import { normText, normPhone, compareText } from './normalize.js';

const defaultColumns = () =>
  STUDENT_FIELDS.map((f, i) => ({ field: f.key, visible: !!f.default, order: i }));

const defaultState = () => ({
  search: '',
  filters: [],                                  // { field, op, value }
  sort: [{ field: 'name', dir: 'asc' }],        // متعدد المستويات
  columns: defaultColumns(),
});

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(LS.query);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    const base = defaultState();
    // دمج الأعمدة مع التعريف الحالي حتى لا يكسر التخزين القديم إضافة حقل جديد
    const saved = new Map((s.columns || []).map((c) => [c.field, c]));
    base.columns = STUDENT_FIELDS.map((f, i) => {
      const c = saved.get(f.key);
      return { field: f.key, visible: c ? !!c.visible : !!f.default, order: c ? c.order : i };
    }).sort((a, b) => a.order - b.order).map((c, i) => ({ ...c, order: i }));
    return { ...base, search: s.search || '', filters: s.filters || [], sort: s.sort?.length ? s.sort : base.sort };
  } catch { return defaultState(); }
}

function persist() {
  try { localStorage.setItem(LS.query, JSON.stringify(state)); } catch { /* تجاهل */ }
  listeners.forEach((fn) => fn(state));
}

export const onQueryChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const getQuery = () => state;
export const resetQuery = () => { state = defaultState(); persist(); };

export function setQuery(patch) {
  state = { ...state, ...patch };
  persist();
}

export const visibleColumns = () =>
  state.columns.filter((c) => c.visible).sort((a, b) => a.order - b.order)
    .map((c) => fieldByKey(STUDENT_FIELDS, c.field)).filter(Boolean);

export function moveColumn(field, dir) {
  const cols = [...state.columns].sort((a, b) => a.order - b.order);
  const i = cols.findIndex((c) => c.field === field);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cols.length) return;
  [cols[i], cols[j]] = [cols[j], cols[i]];
  setQuery({ columns: cols.map((c, k) => ({ ...c, order: k })) });
}

export function toggleColumn(field) {
  setQuery({ columns: state.columns.map((c) => c.field === field ? { ...c, visible: !c.visible } : c) });
}

/* ---------- التنفيذ ---------- */

const cmpValue = (field, v) =>
  field?.ranked ? (LEVEL_RANK[v] ?? RANK_FALLBACK) : (field?.type === 'phone' ? normPhone(v) : normText(v));

function matchOne(row, { field, op, value }) {
  const def = fieldByKey(STUDENT_FIELDS, field);
  const raw = row[field] ?? '';
  const cell = def?.type === 'phone' ? normPhone(raw) : normText(raw);

  if (Array.isArray(value)) {
    if (!value.length) return true;
    const normArr = value.map((v) => def?.type === 'phone' ? normPhone(v) : normText(v));
    if (op === 'notEquals') return !normArr.includes(cell);
    return normArr.includes(cell);
  }

  const val  = def?.type === 'phone' ? normPhone(value) : normText(value);

  switch (op) {
    case 'contains':   return cell.includes(val);
    case 'equals':     return cell === val;
    case 'notEquals':  return cell !== val;
    case 'startsWith': return cell.startsWith(val);
    case 'in':         return (Array.isArray(value) ? value : [value]).map(normText).includes(cell);
    case 'isEmpty':    return cell === '';
    case 'notEmpty':   return cell !== '';
    default:           return true;
  }
}

function matchSearch(row, term) {
  if (!term) return true;
  const t = normText(term);
  const p = normPhone(term);
  return normText(row.name).includes(t) || (p.length >= 3 && normPhone(row.phone).includes(p));
}

/** يطبّق البحث والفلترة والترتيب — هذه هي الدالة التي تعتمد عليها كل الشاشات */
export function runQuery(students, q = state) {
  const rows = students
    .filter((r) => matchSearch(r, q.search))
    .filter((r) => (q.filters || []).every((f) => matchOne(r, f)));

  const sort = q.sort?.length ? q.sort : [{ field: 'name', dir: 'asc' }];
  return rows.sort((a, b) => {
    for (const { field, dir } of sort) {
      const def = fieldByKey(STUDENT_FIELDS, field);
      const av = cmpValue(def, a[field]);
      const bv = cmpValue(def, b[field]);
      let c = typeof av === 'number' && typeof bv === 'number' ? av - bv : compareText(av, bv);
      if (c !== 0) return dir === 'desc' ? -c : c;
    }
    return 0;
  });
}

/** تجميع النتيجة حسب المعلم المتابع — تستخدمه شاشة الرسائل */
export function groupByMentor(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = (r.mentor || '').trim() || 'أخرى / غير محدد';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return [...map.entries()].map(([mentor, students]) => ({ mentor, students }));
}
