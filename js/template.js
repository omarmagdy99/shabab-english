// محرك القوالب — Mustache مبسّط بأسماء عربية
//   {{#معلم}} ... {{/معلم}}   يكرر مرة لكل معلم متابع
//   {{#طلاب}} ... {{/طلاب}}   يكرر مرة لكل طالب (داخل كتلة المعلم أو على المستوى الأعلى)

import { groupByMentor } from './query.js';

export const DEFAULT_TEMPLATE = [
  '{{#معلم}}',
  '📍 المدرس: {{اسم_المعلم}}',
  '{{#طلاب}}',
  '- {{الاسم}} ({{الهاتف}})',
  '{{/طلاب}}',
  '',
  '{{/معلم}}',
  'عدد الطلاب: {{إجمالي_الطلاب}}',
].join('\n');

/** رقاقات شريط المتغيرات */
export const CHIPS = [
  { label: '👤 اسم الطالب',      insert: '{{الاسم}}' },
  { label: '📱 رقم الهاتف',      insert: '{{الهاتف}}' },
  { label: '🎓 المستوى',         insert: '{{المستوى}}' },
  { label: '👨‍🏫 المعلم المتابع', insert: '{{المعلم}}' },
  { label: '🎒 الحالة الجامعية', insert: '{{الحالة_الجامعية}}' },
  { label: '🏛️ مسجل بالمعهد',    insert: '{{المعهد}}' },
  { label: '📅 السنة بالمعهد',   insert: '{{السنة}}' },
  { label: '📝 ملاحظات',         insert: '{{ملاحظات}}' },
  { label: '📊 إجمالي الطلاب',   insert: '{{إجمالي_الطلاب}}' },
  { label: '🔢 عدد طلاب المعلم', insert: '{{عدد_طلاب_المعلم}}' },
  {
    label: '📌 كتلة معلم',
    insert: '{{#معلم}}\n📍 {{اسم_المعلم}}\n{{#طلاب}}\n- {{الاسم}} ({{الهاتف}})\n{{/طلاب}}\n\n{{/معلم}}',
  },
];

const studentVars = (s) => ({
  'الاسم':            s.name || '',
  'الهاتف':           s.phone || '',
  'المستوى':          s.level || '',
  'المعلم':           s.mentor || '',
  'الحالة_الجامعية':  s.uni_status || '',
  'المعهد':           s.enrolled || '',
  'السنة':            s.year || '',
  'ملاحظات':          s.notes || '',
});

/** يستبدل {{المتغير}} بقيمته، ويترك غير المعروف كما هو حتى يلاحظه المستخدم */
function fill(text, vars) {
  return text.replace(/\{\{\s*([^#/}][^}]*?)\s*\}\}/g, (m, key) => {
    const k = key.trim();
    return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m;
  });
}

/** يلتقط أول كتلة {{#name}}…{{/name}} ويعيد { before, inner, after } أو null */
function splitBlock(text, name) {
  const open = `{{#${name}}}`;
  const close = `{{/${name}}}`;
  const i = text.indexOf(open);
  if (i < 0) return null;
  const j = text.indexOf(close, i + open.length);
  if (j < 0) return null;

  // نبتلع سطراً واحداً بعد وسم الفتح/الإغلاق حتى لا تتراكم أسطر فارغة
  const eat = (s, at) => (s[at] === '\n' ? at + 1 : at);
  return {
    before: text.slice(0, i),
    inner:  text.slice(eat(text, i + open.length), j),
    after:  text.slice(eat(text, j + close.length)),
  };
}

function renderStudents(tpl, rows, extra) {
  const block = splitBlock(tpl, 'طلاب');
  if (!block) return fill(tpl, extra);
  const body = rows.map((s) => fill(block.inner, { ...extra, ...studentVars(s) })).join('');
  return fill(block.before, extra) + body + renderStudents(block.after, rows, extra);
}

/**
 * يحوّل القالب إلى نص نهائي.
 * @param {string} tpl
 * @param {Array} rows  نتيجة الفلترة والترتيب الحالية
 */
export function renderTemplate(tpl, rows) {
  const globals = { 'إجمالي_الطلاب': String(rows.length) };
  const block = splitBlock(tpl, 'معلم');

  if (!block) return renderStudents(tpl, rows, globals).trimEnd() + '\n';

  const groups = groupByMentor(rows);
  const body = groups.map((g) =>
    renderStudents(block.inner, g.students, {
      ...globals,
      'اسم_المعلم': g.mentor,
      'عدد_طلاب_المعلم': String(g.students.length),
    })
  ).join('');

  const out = fill(block.before, globals) + body + renderTemplate(block.after, rows);
  return out.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
