// استيراد ملفات Excel / CSV عبر SheetJS — التحليل والمطابقة والتحقق

import { normText, normPhone, isValidPhone } from './normalize.js';
import { LEVELS, YEARS, UNI_STATUS, YES_NO } from './constants.js';

const CDNS = [
  'https://cdn.jsdelivr.net/npm/xlsx@0.20.3/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js',
];

let sheetJsPromise = null;
export function loadSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (sheetJsPromise) return sheetJsPromise;
  sheetJsPromise = new Promise((resolve, reject) => {
    let index = 0;
    const tryNext = () => {
      if (index >= CDNS.length) {
        return reject(new Error('تعذّر تحميل مكتبة قراءة الإكسيل. تأكد من الاتصال بالإنترنت.'));
      }
      const s = document.createElement('script');
      s.src = CDNS[index++];
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => tryNext();
      document.head.appendChild(s);
    };
    tryNext();
  });
  return sheetJsPromise;
}

/** مرادفات عناوين الأعمدة المقبولة تلقائياً */
const SYNONYMS = {
  name:       ['الاسم', 'اسم الطالب', 'الطالب', 'name', 'student', 'student name'],
  phone:      ['الهاتف', 'رقم الهاتف', 'الموبايل', 'رقم الموبايل', 'التليفون', 'phone', 'mobile'],
  level:      ['المستوى', 'المستوي', 'level'],
  mentor:     ['المعلم', 'المعلم المتابع', 'المدرس', 'المتابع', 'mentor', 'teacher'],
  uni_status: ['الحالة الجامعية', 'الحالة', 'طالب/خريج', 'طالب او خريج', 'status'],
  enrolled:   ['المعهد', 'مسجل بالمعهد', 'مسجل في المعهد', 'enrolled'],
  year:       ['السنة', 'السنة بالمعهد', 'السنة الدراسية', 'year'],
  notes:      ['ملاحظات', 'ملحوظات', 'notes'],
};

const LOOKUP = (() => {
  const m = new Map();
  for (const [field, list] of Object.entries(SYNONYMS)) {
    for (const s of list) m.set(normText(s), field);
  }
  return m;
})();

export const IMPORT_FIELDS = [
  { key: 'name',       label: 'الاسم',           required: true },
  { key: 'phone',      label: 'رقم الهاتف',      required: true },
  { key: 'level',      label: 'المستوى',         required: true },
  { key: 'mentor',     label: 'المعلم المتابع',  required: false },
  { key: 'uni_status', label: 'الحالة الجامعية', required: true },
  { key: 'enrolled',   label: 'مسجل بالمعهد',    required: true },
  { key: 'year',       label: 'السنة بالمعهد',   required: false },
  { key: 'notes',      label: 'ملاحظات',         required: false },
];

/** يقرأ الملف ويعيد { headers, rows } — rows مصفوفة مصفوفات نصية */
export async function parseFile(file) {
  const XLSX = await loadSheetJS();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('الملف لا يحتوي على أي ورقة بيانات.');

  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
  if (!matrix.length) throw new Error('الملف فارغ.');

  const headers = (matrix[0] || []).map((h) => String(h ?? '').trim());
  const rows = matrix.slice(1).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  return { headers, rows };
}

/** يطابق العناوين تلقائياً. يعيد { mapping, unknown, missing } */
export function autoMap(headers) {
  const mapping = {};       // field -> column index
  const unknown = [];       // عناوين لم نتعرف عليها
  headers.forEach((h, i) => {
    const field = LOOKUP.get(normText(h));
    if (field && mapping[field] === undefined) mapping[field] = i;
    else if (!field && String(h).trim()) unknown.push({ index: i, header: h });
  });
  const missing = IMPORT_FIELDS.filter((f) => f.required && mapping[f.key] === undefined).map((f) => f.key);
  return { mapping, unknown, missing };
}

/** يصلح رقم الهاتف القادم من إكسيل (فقدان صفر البداية) */
export function fixPhone(v) {
  return normPhone(String(v ?? '').replace(/\.0+$/, ''));
}

const yesNo = (v) => {
  const t = normText(v);
  if (['نعم', 'yes', 'true', '1', 'y', 'مسجل'].includes(t)) return 'نعم';
  if (['لا', 'no', 'false', '0', 'n', 'غير مسجل', ''].includes(t)) return 'لا';
  return '';
};

const matchOption = (v, options) => {
  const t = normText(v);
  return options.find((o) => normText(o) === t) || '';
};

/**
 * يتحقق من كل الصفوف.
 * @returns { valid: [student], invalid: [{ line, name, reason }], warnings: [{line, name, reason}] }
 */
export function validateRows(rows, mapping, { students = [], teachers = [] } = {}) {
  const get = (row, field) => {
    const i = mapping[field];
    return i === undefined ? '' : String(row[i] ?? '').trim();
  };

  const existingPhones = new Map(students.map((s) => [normPhone(s.phone), s.name]));
  const teacherNames = new Set(teachers.map((t) => normText(t.name)));
  const seen = new Map();

  const valid = [], invalid = [], warnings = [];

  rows.forEach((row, idx) => {
    const line = idx + 2;                       // +1 للعنوان و +1 لأن الترقيم يبدأ من 1
    const name = get(row, 'name');
    const fail = (reason) => invalid.push({ line, name, reason });

    if (!name || normText(name).length < 2) return fail('الاسم مفقود أو قصير جداً');

    const phone = fixPhone(get(row, 'phone'));
    if (!isValidPhone(phone)) return fail(`رقم هاتف غير صالح: ${get(row, 'phone') || '(فارغ)'}`);
    if (existingPhones.has(phone)) return fail(`الرقم مسجل بالفعل للطالب: ${existingPhones.get(phone)}`);
    if (seen.has(phone)) return fail(`رقم مكرر داخل الملف (السطر ${seen.get(phone)})`);

    const level = matchOption(get(row, 'level'), LEVELS);
    if (!level) return fail(`مستوى غير معروف: ${get(row, 'level') || '(فارغ)'}`);

    const uni_status = matchOption(get(row, 'uni_status'), UNI_STATUS) || 'طالب';

    const enrolled = yesNo(get(row, 'enrolled'));
    if (!enrolled) return fail(`قيمة (مسجل بالمعهد) غير مفهومة: ${get(row, 'enrolled')}`);

    let year = matchOption(get(row, 'year'), YEARS);
    if (enrolled === 'نعم' && !year) return fail('السنة بالمعهد مطلوبة لأن الطالب مسجل بالمعهد');
    if (enrolled === 'لا') year = '';

    const mentor = get(row, 'mentor');
    if (mentor && !teacherNames.has(normText(mentor))) {
      warnings.push({ line, name, reason: `المعلم غير مسجل: ${mentor} — أضفه من شاشة المعلمين أولاً` });
      return fail(`المعلم غير موجود: ${mentor}`);
    }

    seen.set(phone, line);
    valid.push({ name, phone, level, mentor, uni_status, enrolled, year, notes: get(row, 'notes') });
  });

  return { valid, invalid, warnings };
}

export const YES_NO_VALUES = YES_NO;

/** إنشاء وتنزيل ملف نموذج إكسيل جاهز للاستيراد */
export async function downloadSampleTemplate() {
  const data = [
    ['الاسم', 'رقم الهاتف', 'المستوى', 'المعلم المتابع', 'الحالة الجامعية', 'مسجل بالمعهد', 'السنة بالمعهد', 'ملاحظات'],
    ['أحمد محمد علي', '01012345678', 'أ', 'عمر مجدي', 'طالب', 'نعم', 'الأولى', 'طالب ممتاز'],
    ['محمود إبراهيم', '01198765432', 'ب', '', 'خريج', 'لا', '', 'اختياري بدون معلم']
  ];

  try {
    const XLSX = await loadSheetJS();
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [
      { wch: 22 }, { wch: 16 }, { wch: 10 },
      { wch: 18 }, { wch: 15 }, { wch: 15 },
      { wch: 15 }, { wch: 25 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الطلاب');
    XLSX.writeFile(wb, 'نموذج_استيراد_الطلاب.xlsx');
  } catch {
    // CSV Fallback if completely offline
    const csvContent = "\uFEFF" + data.map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'نموذج_استيراد_الطلاب.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
