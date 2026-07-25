// تطبيع النصوص العربية وأرقام الهواتف — كل مقارنة نصية في التطبيق تمر من هنا.
// البيانات الأصلية لا تتغير أبداً؛ التطبيع للمقارنة والبحث فقط.

const TASHKEEL = /[ً-ْـ]/g;   // التشكيل + التطويل
const ALEF     = /[أإآٱ]/g;

export function normText(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(TASHKEEL, '')
    .replace(ALEF, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))  // ٠-٩
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))  // ۰-۹
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normPhone(s) {
  let t = normText(s).replace(/[\s\-()+]/g, '');
  if (t.startsWith('0020')) t = '0' + t.slice(4);
  else if (t.startsWith('20') && t.length === 12) t = '0' + t.slice(2);
  if (t.length === 10 && t[0] === '1') t = '0' + t;
  return t;
}

export const isValidPhone = (p) => /^01[0125][0-9]{8}$/.test(normPhone(p));

/** رابط واتساب مباشر للرقم المصري */
export const waLink = (phone) => 'https://wa.me/2' + normPhone(phone);

/** مقارنة عربية صحيحة للترتيب الأبجدي */
const collator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });
export const compareText = (a, b) => collator.compare(normText(a), normText(b));
