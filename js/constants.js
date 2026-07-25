// القوائم الثابتة ووصف الحقول — كل واجهات الفلترة والترتيب والأعمدة تُبنى من هنا

export const LEVELS     = ['معلم', 'أ', 'أ/', 'ب', 'ب/', 'ج', 'ج/'];
export const YEARS      = ['تمهيدي', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة'];
export const UNI_STATUS = ['طالب', 'خريج'];
export const YES_NO     = ['نعم', 'لا'];

/** ترتيب رتبي للمستويات — غير الموجود يذهب لآخر القائمة */
export const LEVEL_RANK = LEVELS.reduce((m, l, i) => (m[l] = i, m), {});
export const RANK_FALLBACK = 99;

/** وصف حقول الطالب: يقود الجدول والفلترة والترتيب ومحدد الأعمدة */
export const STUDENT_FIELDS = [
  { key: 'name',       label: 'الاسم',            type: 'text',  default: true  },
  { key: 'phone',      label: 'رقم الهاتف',       type: 'phone', default: true  },
  { key: 'level',      label: 'المستوى',          type: 'enum',  default: true, options: LEVELS, ranked: true },
  { key: 'mentor',     label: 'المعلم المتابع',   type: 'ref',   default: true  },
  { key: 'uni_status', label: 'الحالة الجامعية',  type: 'enum',  default: true, options: UNI_STATUS },
  { key: 'enrolled',   label: 'مسجل بالمعهد',     type: 'enum',  default: true, options: YES_NO },
  { key: 'year',       label: 'السنة بالمعهد',    type: 'enum',  default: true, options: YEARS },
  { key: 'notes',      label: 'ملاحظات',          type: 'text',  default: false },
  { key: 'created_at', label: 'تاريخ الإضافة',    type: 'date',  default: false },
];

export const TEACHER_FIELDS = [
  { key: 'name',     label: 'الاسم',           type: 'text',   default: true },
  { key: 'phone',    label: 'رقم الهاتف',      type: 'phone',  default: true },
  { key: 'source',   label: 'المصدر',          type: 'enum',   default: true, options: ['تلقائي', 'يدوي'] },
  { key: 'mentees',  label: 'عدد المتابعين',   type: 'number', default: true },
];

/** الحقول المسموح تعديلها جماعياً — مطابقة لـ BULK_EDITABLE في Code.gs */
export const BULK_EDITABLE = ['level', 'mentor', 'uni_status', 'enrolled', 'year'];

export const FILTER_OPS = [
  { key: 'contains',  label: 'يحتوي على',  types: ['text', 'phone', 'ref', 'enum'] },
  { key: 'equals',    label: 'يساوي',       types: ['text', 'phone', 'ref', 'enum', 'number', 'date'] },
  { key: 'notEquals', label: 'لا يساوي',    types: ['text', 'phone', 'ref', 'enum', 'number', 'date'] },
  { key: 'startsWith',label: 'يبدأ بـ',     types: ['text', 'phone', 'ref'] },
  { key: 'in',        label: 'ضمن',         types: ['enum', 'ref'] },
  { key: 'isEmpty',   label: 'فارغ',        types: ['text', 'phone', 'ref', 'enum', 'date'], noValue: true },
  { key: 'notEmpty',  label: 'غير فارغ',    types: ['text', 'phone', 'ref', 'enum', 'date'], noValue: true },
];

export const opsFor = (type) => FILTER_OPS.filter((o) => o.types.includes(type));
export const fieldByKey = (fields, key) => fields.find((f) => f.key === key) || null;
