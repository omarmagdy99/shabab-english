/**
 * Shabab English — Google Apps Script Backend
 * =============================================================================
 * قاعدة البيانات: Google Sheet بأربع أوراق (students / teachers / archive / log)
 * نقطة الاتصال الوحيدة: doPost بحمولة text/plain تحتوي JSON
 *
 * خطوات التركيب:
 *   1. الصق هذا الكود كاملاً في Apps Script (Extensions ← Apps Script)
 *   2. من القائمة أعلى المحرر اختر الدالة setup ثم اضغط Run  (مرة واحدة فقط)
 *      ← ستنشئ الأوراق الأربع بعناوينها وتضبط تنسيق أعمدة الهاتف تلقائياً
 *   3. Deploy ← New deployment ← Web app
 *        Execute as: Me          |  Who has access: Anyone
 *   4. انسخ Web App URL وضعه في js/config.js
 *
 * ⚠️ بعد أي تعديل على هذا الكود:
 *    Deploy ← Manage deployments ← Edit (قلم) ← Version: New version ← Deploy
 * =============================================================================
 */

/* ==========================================================================
 * 1) الإعدادات
 * ========================================================================== */

var PASSCODE = '55555';          // الرقم السري — غيّره هنا لقيمة أطول وقت ما تحب
var LOG_RETENTION_DAYS = 90;     // مدة الاحتفاظ بسجل العمليات (التراجع متاح خلالها)
var LOG_LIST_LIMIT = 200;        // عدد العمليات المرسلة للتطبيق في كل تحميل
var MAX_JSON_CELL = 40000;       // حد أمان لحجم خانة JSON (حد جوجل 50000 حرف)
var LOCK_WAIT_MS = 10000;        // مهلة انتظار القفل

var SH = { students: 'students', teachers: 'teachers', archive: 'archive', log: 'log', templates: 'templates' };

var STUDENT_FIELDS = ['id', 'name', 'phone', 'level', 'mentor', 'uni_status',
                      'enrolled', 'year', 'notes', 'created_at', 'updated_at'];

var TEACHER_FIELDS = ['id', 'name', 'phone', 'source', 'student_id', 'notes',
                      'created_at', 'updated_at'];

// اتحاد أعمدة كل الكيانات القابلة للأرشفة (طالب / معلم / قالب).
// ⚠️ أي حقل ناقص هنا يُفقد نهائياً عند الحذف ولا يعود بالاسترجاع أو التراجع.
// ⚠️ الإضافة تكون في آخر المصفوفة فقط — الإدراج في المنتصف يزيح بيانات الأرشيف القديمة.
var ARCHIVE_FIELDS = ['entity', 'id', 'name', 'phone', 'level', 'mentor', 'uni_status',
                      'enrolled', 'year', 'notes', 'source', 'student_id',
                      'created_at', 'updated_at', 'deleted_at', 'log_id',
                      'content', 'query_json'];

var LOG_FIELDS = ['id', 'timestamp', 'action', 'entity', 'summary_ar', 'target_ids',
                  'before_json', 'after_json', 'side_effects_json',
                  'undone', 'undone_at', 'undo_of'];

var TEMPLATE_FIELDS = ['id', 'name', 'content', 'query_json', 'created_at', 'updated_at'];

var LEVELS     = ['معلم', 'أ', 'أ/', 'ب', 'ب/', 'ج', 'ج/'];
var YEARS      = ['تمهيدي', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة'];
var UNI_STATUS = ['طالب', 'خريج'];
var YES_NO     = ['نعم', 'لا'];

var BULK_EDITABLE = ['level', 'mentor', 'uni_status', 'enrolled', 'year'];

var E_STUDENT = 'طالب';
var E_TEACHER = 'معلم';


/* ==========================================================================
 * 2) التركيب لمرة واحدة
 * ========================================================================== */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SH.students, STUDENT_FIELDS, ['phone']);
  ensureSheet_(ss, SH.teachers, TEACHER_FIELDS, ['phone']);
  ensureSheet_(ss, SH.archive,  ARCHIVE_FIELDS, ['phone']);
  ensureSheet_(ss, SH.log,      LOG_FIELDS,     []);
  ensureSheet_(ss, SH.templates, TEMPLATE_FIELDS, []);
  var msg = 'تم إنشاء الأوراق الخمس بنجاح. يمكنك الآن نشر التطبيق (Deploy).';
  try { SpreadsheetApp.getUi().alert(msg); } catch (noUi) { Logger.log(msg); }
}

function ensureSheet_(ss, name, fields, textCols) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, fields.length).setValues([fields]).setFontWeight('bold');
  sh.setFrozenRows(1);
  for (var i = 0; i < textCols.length; i++) {
    var idx = fields.indexOf(textCols[i]);
    if (idx >= 0) sh.getRange(1, idx + 1, sh.getMaxRows()).setNumberFormat('@');
  }
  return sh;
}


/* ==========================================================================
 * 3) نقطة الدخول
 * ========================================================================== */

function doGet() {
  return ContentService.createTextOutput('not used')
                       .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (parseErr) {
    return out_(err_(400, 'صيغة الطلب غير صالحة.'));
  }

  if (String(req.pass || '') !== String(PASSCODE)) {
    return out_(err_(401, 'الرقم السري غير صحيح.'));
  }

  var readOnly = { list: 1, listArchive: 1 };
  try {
    if (readOnly[req.action]) return out_(route_(req));
    return out_(withLock_(function () { return route_(req); }));
  } catch (ex) {
    return out_(err_(500, 'خطأ غير متوقع: ' + (ex && ex.message ? ex.message : ex)));
  }
}

function route_(req) {
  switch (req.action) {
    case 'list':          return actList_();
    case 'listArchive':   return actListArchive_();
    case 'create':        return actCreateStudent_(req.student);
    case 'update':        return actUpdateStudent_(req.student);
    case 'delete':        return actDeleteStudent_(req.id, req.expected_updated_at);
    case 'bulkCreate':    return actBulkCreate_(req.students);
    case 'bulkUpdate':    return actBulkUpdate_(req.ids, req.field, req.value);
    case 'bulkDelete':    return actBulkDelete_(req.ids);
    case 'createTeacher': return actCreateTeacher_(req.teacher);
    case 'updateTeacher': return actUpdateTeacher_(req.teacher);
    case 'deleteTeacher': return actDeleteTeacher_(req.id);
    case 'undo':          return actUndo_(req.log_id, !!req.force);
    case 'restore':       return actRestore_(req.id);
    case 'saveTemplate':   return actSaveTemplate_(req.name, req.content, req.query);
    case 'deleteTemplate': return actDeleteTemplate_(req.id || req.name);
    default:              return err_(400, 'عملية غير معروفة: ' + req.action);
  }
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    return err_(423, 'الخادم مشغول بعملية أخرى. برجاء إعادة المحاولة بعد لحظات.');
  }
  try { return fn(); } finally { lock.releaseLock(); }
}

function out_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
                       .setMimeType(ContentService.MimeType.JSON);
}
function ok_(data)  { return { status: 'success', data: data }; }
function err_(code, msg, data) {
  var o = { status: 'error', code: code, message: msg };
  if (data) o.data = data;
  return o;
}


/* ==========================================================================
 * 4) أدوات الوصول للأوراق
 * ========================================================================== */

function sheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('الورقة "' + name + '" غير موجودة. شغّل الدالة setup أولاً.');
  return sh;
}

/** يقرأ الورقة كاملة ويعيد كائنات مع رقم الصف الفعلي في _row */
function readTable_(name, fields) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return { sheet: sh, rows: [], byId: {} };

  var values = sh.getRange(2, 1, last - 1, fields.length).getValues();
  var rows = [], byId = {};
  for (var i = 0; i < values.length; i++) {
    var o = {};
    for (var c = 0; c < fields.length; c++) o[fields[c]] = asText_(values[i][c]);
    if (!o.id) continue;
    o._row = i + 2;
    rows.push(o);
    byId[o.id] = o;
  }
  return { sheet: sh, rows: rows, byId: byId };
}

function asText_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function objToRow_(obj, fields) {
  var row = [];
  for (var i = 0; i < fields.length; i++) row.push(obj[fields[i]] === undefined ? '' : obj[fields[i]]);
  return row;
}

function appendRows_(name, fields, objs) {
  if (!objs.length) return;
  var sh = sheet_(name);
  var start = sh.getLastRow() + 1;
  var rows = objs.map(function (o) { return objToRow_(o, fields); });
  sh.getRange(start, 1, rows.length, fields.length).setValues(rows);
}

function writeRow_(name, fields, rowIndex, obj) {
  sheet_(name).getRange(rowIndex, 1, 1, fields.length).setValues([objToRow_(obj, fields)]);
}

/** يحذف صفوفاً متعددة بأمان (من الأسفل للأعلى) */
function deleteRows_(name, rowIndexes) {
  if (!rowIndexes.length) return;
  var sh = sheet_(name);
  rowIndexes.slice().sort(function (a, b) { return b - a; })
            .forEach(function (r) { sh.deleteRow(r); });
}

function nowIso_() { return new Date().toISOString(); }

function newId_(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

function pick_(obj, fields) {
  var o = {};
  for (var i = 0; i < fields.length; i++) o[fields[i]] = obj[fields[i]] === undefined ? '' : obj[fields[i]];
  return o;
}


/* ==========================================================================
 * 5) التطبيع والتحقق
 * ========================================================================== */

function normText_(s) {
  if (s === null || s === undefined) return '';
  var t = String(s);
  t = t.replace(/[ً-ْـ]/g, '');            // تشكيل + تطويل
  t = t.replace(/[أإآٱ]/g, 'ا');       // أ إ آ ٱ ← ا
  t = t.replace(/ة/g, 'ه');                           // ة ← ه
  t = t.replace(/ى/g, 'ي');                           // ى ← ي
  t = t.replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');   // ؤ ← و  |  ئ ← ي
  t = t.replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); });
  t = t.replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); });
  return t.replace(/\s+/g, ' ').trim();
}

function normPhone_(s) {
  var t = normText_(s).replace(/[\s\-\(\)\+]/g, '');
  if (t.indexOf('0020') === 0) t = '0' + t.substring(4);
  else if (t.indexOf('20') === 0 && t.length === 12) t = '0' + t.substring(2);
  if (t.length === 10 && t.charAt(0) === '1') t = '0' + t;
  return t;
}

function isValidPhone_(p) { return /^01[0125][0-9]{8}$/.test(p); }

function inList_(v, list) { return list.indexOf(v) >= 0; }

/**
 * يتحقق من بيانات طالب ويعيد { ok:true, student } أو { ok:false, reason }
 * القاعدة المهمة: السنة مرتبطة بـ enrolled وحده — لا علاقة لها بالحالة الجامعية.
 */
function validateStudent_(raw, ctx, selfId) {
  var s = {
    name:       asText_(raw && raw.name),
    phone:      normPhone_(raw && raw.phone),
    level:      asText_(raw && raw.level),
    mentor:     asText_(raw && raw.mentor),
    uni_status: asText_(raw && raw.uni_status),
    enrolled:   asText_(raw && raw.enrolled),
    year:       asText_(raw && raw.year),
    notes:      asText_(raw && raw.notes)
  };

  if (normText_(s.name).length < 2) return { ok: false, reason: 'الاسم مطلوب (حرفان على الأقل).' };
  if (!isValidPhone_(s.phone))      return { ok: false, reason: 'رقم الهاتف غير صالح: ' + (raw && raw.phone) };
  if (!inList_(s.level, LEVELS))    return { ok: false, reason: 'مستوى غير معروف: ' + s.level };
  if (!inList_(s.uni_status, UNI_STATUS)) return { ok: false, reason: 'الحالة الجامعية يجب أن تكون (طالب) أو (خريج).' };
  if (!inList_(s.enrolled, YES_NO)) return { ok: false, reason: 'حقل (مسجل بالمعهد) يجب أن يكون (نعم) أو (لا).' };

  if (s.enrolled === 'نعم') {
    if (!s.year) return { ok: false, reason: 'السنة بالمعهد مطلوبة لأن الطالب مسجل بالمعهد.' };
    if (!inList_(s.year, YEARS)) return { ok: false, reason: 'سنة غير معروفة: ' + s.year };
  } else {
    s.year = '';   // غير مسجل بالمعهد ← لا سنة
  }

  if (s.mentor && !findTeacherByName_(ctx, s.mentor)) {
    return { ok: false, reason: 'المعلم المتابع غير موجود في قائمة المعلمين: ' + s.mentor };
  }

  var dup = findStudentByPhone_(ctx, s.phone, selfId);
  if (dup) return { ok: false, reason: 'رقم الهاتف مسجل بالفعل للطالب: ' + dup.name };

  return { ok: true, student: s };
}

function findStudentByPhone_(ctx, phone, excludeId) {
  var p = normPhone_(phone);
  for (var i = 0; i < ctx.students.rows.length; i++) {
    var st = ctx.students.rows[i];
    if (st.id === excludeId) continue;
    if (normPhone_(st.phone) === p) return st;
  }
  return null;
}

function findTeacherByName_(ctx, name) {
  var n = normText_(name);
  for (var i = 0; i < ctx.teachers.rows.length; i++) {
    if (normText_(ctx.teachers.rows[i].name) === n) return ctx.teachers.rows[i];
  }
  return null;
}

function findTeacherByStudentId_(ctx, studentId) {
  for (var i = 0; i < ctx.teachers.rows.length; i++) {
    if (ctx.teachers.rows[i].student_id === studentId) return ctx.teachers.rows[i];
  }
  return null;
}

function countMentees_(ctx, teacherName) {
  var n = normText_(teacherName), c = 0, names = [];
  for (var i = 0; i < ctx.students.rows.length; i++) {
    if (normText_(ctx.students.rows[i].mentor) === n) {
      c++;
      if (names.length < 10) names.push(ctx.students.rows[i].name);
    }
  }
  return { count: c, names: names };
}

/** يقرأ الورقتين مرة واحدة لكل طلب */
function loadCtx_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SH.templates, TEMPLATE_FIELDS, []);
  return {
    students: readTable_(SH.students, STUDENT_FIELDS),
    teachers: readTable_(SH.teachers, TEACHER_FIELDS),
    templates: readTable_(SH.templates, TEMPLATE_FIELDS)
  };
}


/* ==========================================================================
 * 6) السجل والأرشيف
 * --------------------------------------------------------------------------
 * كل عملية كتابة تُسجَّل بلقطتين:
 *   before / after  بالشكل { mode: 'none' | 'records' | 'archive', ... }
 *     none    : لم يكن السجل موجوداً (أو لم يعد موجوداً)
 *     records : مصفوفة سجلات — كاملة أو جزئية (الحقول الموجودة فقط تُطبَّق)
 *     archive : السجلات موجودة في ورقة archive وتُسترجع منها بمعرفاتها
 * التراجع يعيد تطبيق before ويتحقق أن الوضع الحالي ما زال مطابقاً لـ after.
 * ========================================================================== */

function snapNone_(ids)      { return { mode: 'none',    ids: ids || [] }; }
function snapRecords_(recs)  { return { mode: 'records', records: recs }; }
function snapArchive_(ids)   { return { mode: 'archive', ids: ids }; }

function stamps_(recs) {
  return recs.map(function (r) { return { id: r.id, updated_at: r.updated_at }; });
}

function safeJson_(obj) {
  var s = JSON.stringify(obj || null);
  if (s.length > MAX_JSON_CELL) return JSON.stringify({ mode: 'too_large' });
  return s;
}

/**
 * يكتب سطراً في السجل ويعيد معرّفه.
 * side: { entity, before, after } للآثار الجانبية (مزامنة المعلمين) — اختياري
 */
function writeLog_(action, entity, summary, ids, before, after, side, undoOf) {
  var id = newId_('log');
  appendRows_(SH.log, LOG_FIELDS, [{
    id: id,
    timestamp: nowIso_(),
    action: action,
    entity: entity,
    summary_ar: summary,
    target_ids: (ids || []).join(','),
    before_json: safeJson_(before),
    after_json: safeJson_(after),
    side_effects_json: side ? safeJson_(side) : '',
    undone: 'لا',
    undone_at: '',
    undo_of: undoOf || ''
  }]);
  return id;
}

function archiveRecords_(entity, records, logId) {
  if (!records.length) return;
  var rows = records.map(function (r) {
    // حارس: أي حقل في السجل غير موجود في ARCHIVE_FIELDS سيُفقد عند الأرشفة.
    // نسجّله في اللوج بدل أن يضيع بصمت (كان هذا سبب ضياع نص القوالب سابقاً).
    Object.keys(r).forEach(function (k) {
      if (k.charAt(0) !== '_' && ARCHIVE_FIELDS.indexOf(k) < 0) {
        Logger.log('ARCHIVE WARNING: الحقل "' + k + '" للكيان "' + entity +
                   '" غير موجود في ARCHIVE_FIELDS وسيُفقد عند الاسترجاع.');
      }
    });
    var a = pick_(r, ARCHIVE_FIELDS);
    a.entity = entity;
    a.deleted_at = nowIso_();
    a.log_id = logId;
    return a;
  });
  appendRows_(SH.archive, ARCHIVE_FIELDS, rows);
}

/** يسحب سجلات من الأرشيف بمعرفاتها ويحذفها منه */
function popFromArchive_(entity, ids) {
  var t = readTable_(SH.archive, ARCHIVE_FIELDS);
  var wanted = {}, found = [], rowsToDelete = [];
  ids.forEach(function (i) { wanted[i] = true; });

  for (var i = t.rows.length - 1; i >= 0; i--) {          // الأحدث أولاً
    var r = t.rows[i];
    if (r.entity === entity && wanted[r.id]) {
      found.push(r);
      rowsToDelete.push(r._row);
      wanted[r.id] = false;
    }
  }
  deleteRows_(SH.archive, rowsToDelete);
  return found;
}

function cleanOldLogs_() {
  var t = readTable_(SH.log, LOG_FIELDS);
  var cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 3600 * 1000;
  var doomed = t.rows.filter(function (r) {
    var ts = Date.parse(r.timestamp);
    return ts && ts < cutoff;
  }).map(function (r) { return r._row; });
  deleteRows_(SH.log, doomed);
}


/* ==========================================================================
 * 7) القراءة
 * ========================================================================== */

function actList_() {
  var ctx = loadCtx_();
  var log = readTable_(SH.log, LOG_FIELDS);
  var cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 3600 * 1000;

  var entries = log.rows.slice(-LOG_LIST_LIMIT).reverse().map(function (r) {
    var ts = Date.parse(r.timestamp) || 0;
    var tooLarge = r.before_json.indexOf('too_large') >= 0 || r.after_json.indexOf('too_large') >= 0;
    return {
      id: r.id,
      timestamp: r.timestamp,
      action: r.action,
      entity: r.entity,
      summary_ar: r.summary_ar,
      target_ids: r.target_ids,
      undone: r.undone,
      undo_of: r.undo_of,
      can_undo: r.undone !== 'نعم' && ts >= cutoff && !tooLarge
    };
  });

  return ok_({
    students: ctx.students.rows.map(function (r) { return pick_(r, STUDENT_FIELDS); }),
    teachers: ctx.teachers.rows.map(function (r) { return pick_(r, TEACHER_FIELDS); }),
    templates: (ctx.templates ? ctx.templates.rows : []).map(function (r) { return pick_(r, TEMPLATE_FIELDS); }),
    log: entries
  });
}

function actListArchive_() {
  var t = readTable_(SH.archive, ARCHIVE_FIELDS);
  return ok_({ archive: t.rows.map(function (r) { return pick_(r, ARCHIVE_FIELDS); }).reverse() });
}


/* ==========================================================================
 * 8) مزامنة المعلمين
 * ========================================================================== */

/**
 * يضمن وجود سجل معلم تلقائي للطالب، أو يحدّثه ليطابق اسمه وهاتفه.
 * يعيد { created:[], updated:[], before:[] } لتسجيلها كأثر جانبي.
 */
function ensureAutoTeacher_(ctx, student) {
  var existing = findTeacherByStudentId_(ctx, student.id);
  var now = nowIso_();

  if (!existing) {
    var clash = findTeacherByName_(ctx, student.name);
    if (clash) {
      // يوجد معلم بنفس الاسم — نربطه بالطالب بدل إنشاء تكرار
      var beforeClash = pick_(clash, TEACHER_FIELDS);
      clash.source = 'تلقائي';
      clash.student_id = student.id;
      clash.phone = student.phone;
      clash.updated_at = now;
      writeRow_(SH.teachers, TEACHER_FIELDS, clash._row, clash);
      return { before: snapRecords_([beforeClash]),
               after: snapRecords_(stamps_([clash])),
               ids: [clash.id] };
    }
    var t = {
      id: newId_('tch'), name: student.name, phone: student.phone,
      source: 'تلقائي', student_id: student.id, notes: '',
      created_at: now, updated_at: now
    };
    appendRows_(SH.teachers, TEACHER_FIELDS, [t]);
    ctx.teachers.rows.push(t);
    return { before: snapNone_([t.id]), after: snapRecords_(stamps_([t])), ids: [t.id] };
  }

  if (existing.name === student.name && existing.phone === student.phone) return null;

  var before = pick_(existing, TEACHER_FIELDS);
  var oldName = existing.name;
  existing.name = student.name;
  existing.phone = student.phone;
  existing.updated_at = now;
  writeRow_(SH.teachers, TEACHER_FIELDS, existing._row, existing);

  var cascade = cascadeRename_(ctx, oldName, student.name);
  return {
    before: snapRecords_([before]),
    after: snapRecords_(stamps_([existing])),
    ids: [existing.id],
    cascade: cascade
  };
}

/** إعادة تسمية متتالية: تحديث حقل mentor لكل طلاب المعلم */
function cascadeRename_(ctx, oldName, newName) {
  if (normText_(oldName) === normText_(newName)) return null;
  var changed = [], before = [];
  var now = nowIso_();
  ctx.students.rows.forEach(function (st) {
    if (normText_(st.mentor) === normText_(oldName)) {
      before.push({ id: st.id, mentor: st.mentor, updated_at: st.updated_at });
      st.mentor = newName;
      st.updated_at = now;
      writeRow_(SH.students, STUDENT_FIELDS, st._row, st);
      changed.push(st);
    }
  });
  if (!changed.length) return null;
  return { before: snapRecords_(before), after: snapRecords_(stamps_(changed)),
           ids: changed.map(function (s) { return s.id; }) };
}

/**
 * يتحقق قبل إزالة صفة المعلم عن طالب (تغيير مستواه أو حذفه).
 * يعيد null إذا كان الطريق سالكاً، أو كائن خطأ 428.
 */
function guardAutoTeacher_(ctx, student) {
  var t = findTeacherByStudentId_(ctx, student.id);
  if (!t) return null;
  var m = countMentees_(ctx, t.name);
  if (m.count > 0) {
    return err_(428,
      'لا يمكن تنفيذ هذه العملية: ' + t.name + ' متابع لـ ' + m.count + ' طلاب. ' +
      'انقل الطلاب لمعلم آخر أولاً.',
      { students_count: m.count, student_names: m.names, teacher_id: t.id });
  }
  return null;
}

/** يؤرشف سجل المعلم التلقائي المرتبط بالطالب — بعد التأكد من guardAutoTeacher_ */
function removeAutoTeacher_(ctx, student, logId) {
  var t = findTeacherByStudentId_(ctx, student.id);
  if (!t) return null;
  archiveRecords_(E_TEACHER, [pick_(t, TEACHER_FIELDS)], logId);
  deleteRows_(SH.teachers, [t._row]);
  ctx.teachers.rows = ctx.teachers.rows.filter(function (x) { return x.id !== t.id; });
  return { before: snapArchive_([t.id]), after: snapNone_([t.id]), ids: [t.id] };
}


/* ==========================================================================
 * 9) عمليات الطلاب
 * ========================================================================== */

function actCreateStudent_(raw) {
  var ctx = loadCtx_();
  var v = validateStudent_(raw, ctx, null);
  if (!v.ok) return err_(400, v.reason);

  var now = nowIso_();
  var st = v.student;
  st.id = newId_('std');
  st.created_at = now;
  st.updated_at = now;

  appendRows_(SH.students, STUDENT_FIELDS, [st]);
  ctx.students.rows.push(st);

  var side = null;
  if (st.level === 'معلم') {
    var s = ensureAutoTeacher_(ctx, st);
    if (s) side = { entity: E_TEACHER, before: s.before, after: s.after };
  }

  var logId = writeLog_('إضافة', E_STUDENT, 'إضافة طالب: ' + st.name, [st.id],
                        snapNone_([st.id]), snapRecords_(stamps_([st])), side);

  return ok_({ student: pick_(st, STUDENT_FIELDS), log_id: logId,
               teacher_created: side ? true : false });
}

function actUpdateStudent_(raw) {
  var ctx = loadCtx_();
  var cur = ctx.students.byId[raw && raw.id];
  if (!cur) return err_(404, 'الطالب غير موجود.');

  if (raw.expected_updated_at && raw.expected_updated_at !== cur.updated_at) {
    return err_(409, 'تم تعديل بيانات هذا الطالب بواسطة مشرف آخر. يرجى تحديث البيانات وإعادة المحاولة.');
  }

  var v = validateStudent_(raw, ctx, cur.id);
  if (!v.ok) return err_(400, v.reason);

  var before = pick_(cur, STUDENT_FIELDS);
  var wasTeacher = cur.level === 'معلم';
  var willBeTeacher = v.student.level === 'معلم';

  if (wasTeacher && !willBeTeacher) {
    var blocked = guardAutoTeacher_(ctx, cur);
    if (blocked) return blocked;
  }

  var now = nowIso_();
  var next = v.student;
  next.id = cur.id;
  next.created_at = cur.created_at;
  next.updated_at = now;

  writeRow_(SH.students, STUDENT_FIELDS, cur._row, next);
  next._row = cur._row;
  ctx.students.byId[cur.id] = next;
  ctx.students.rows = ctx.students.rows.map(function (s) { return s.id === cur.id ? next : s; });

  var logId = newId_('log');
  var side = null;

  if (wasTeacher && !willBeTeacher) {
    var rem = removeAutoTeacher_(ctx, cur, logId);
    if (rem) side = { entity: E_TEACHER, before: rem.before, after: rem.after };
  } else if (willBeTeacher) {
    var sync = ensureAutoTeacher_(ctx, next);
    if (sync) {
      side = { entity: E_TEACHER, before: sync.before, after: sync.after };
      if (sync.cascade) side.cascade = sync.cascade;
    }
  }

  appendRows_(SH.log, LOG_FIELDS, [{
    id: logId, timestamp: nowIso_(), action: 'تعديل', entity: E_STUDENT,
    summary_ar: 'تعديل: ' + next.name + diffSummary_(before, next),
    target_ids: next.id,
    before_json: safeJson_(snapRecords_([before])),
    after_json: safeJson_(snapRecords_(stamps_([next]))),
    side_effects_json: side ? safeJson_(side) : '',
    undone: 'لا', undone_at: '', undo_of: ''
  }]);

  return ok_({ student: pick_(next, STUDENT_FIELDS), log_id: logId });
}

function diffSummary_(before, after) {
  var labels = { name: 'الاسم', phone: 'الهاتف', level: 'المستوى', mentor: 'المعلم المتابع',
                 uni_status: 'الحالة الجامعية', enrolled: 'مسجل بالمعهد', year: 'السنة', notes: 'ملاحظات' };
  var parts = [];
  Object.keys(labels).forEach(function (k) {
    if (String(before[k] || '') !== String(after[k] || '')) {
      parts.push(labels[k] + ' من (' + (before[k] || '—') + ') إلى (' + (after[k] || '—') + ')');
    }
  });
  return parts.length ? ' — ' + parts.join('، ') : '';
}

function actDeleteStudent_(id, expected) {
  var ctx = loadCtx_();
  var cur = ctx.students.byId[id];
  if (!cur) return err_(404, 'الطالب غير موجود.');
  if (expected && expected !== cur.updated_at) {
    return err_(409, 'تم تعديل بيانات هذا الطالب بواسطة مشرف آخر. يرجى التحديث وإعادة المحاولة.');
  }

  var blocked = guardAutoTeacher_(ctx, cur);
  if (blocked) return blocked;

  var logId = newId_('log');
  var rec = pick_(cur, STUDENT_FIELDS);
  archiveRecords_(E_STUDENT, [rec], logId);
  deleteRows_(SH.students, [cur._row]);
  ctx.students.rows = ctx.students.rows.filter(function (s) { return s.id !== id; });

  var rem = removeAutoTeacher_(ctx, cur, logId);
  var side = rem ? { entity: E_TEACHER, before: rem.before, after: rem.after } : null;

  appendRows_(SH.log, LOG_FIELDS, [{
    id: logId, timestamp: nowIso_(), action: 'حذف', entity: E_STUDENT,
    summary_ar: 'حذف: ' + cur.name,
    target_ids: id,
    before_json: safeJson_(snapArchive_([id])),
    after_json: safeJson_(snapNone_([id])),
    side_effects_json: side ? safeJson_(side) : '',
    undone: 'لا', undone_at: '', undo_of: ''
  }]);

  return ok_({ id: id, deleted: true, log_id: logId });
}


/* ==========================================================================
 * 10) العمليات الجماعية
 * ========================================================================== */

function actBulkCreate_(list) {
  if (!list || !list.length) return err_(400, 'لا توجد بيانات للاستيراد.');
  var ctx = loadCtx_();
  var now = nowIso_();
  var created = [], skipped = [], teacherSides = [];

  for (var i = 0; i < list.length; i++) {
    var v = validateStudent_(list[i], ctx, null);
    if (!v.ok) { skipped.push({ row: i + 1, name: (list[i] && list[i].name) || '', reason: v.reason }); continue; }
    var st = v.student;
    st.id = newId_('std');
    st.created_at = now;
    st.updated_at = now;
    created.push(st);
    ctx.students.rows.push(st);   // حتى يُكتشف التكرار داخل نفس الملف
  }

  if (!created.length) return err_(400, 'كل الصفوف مرفوضة.', { skipped: skipped });

  appendRows_(SH.students, STUDENT_FIELDS, created);

  var logId = newId_('log');
  created.forEach(function (st) {
    if (st.level === 'معلم') {
      var s = ensureAutoTeacher_(ctx, st);
      if (s) teacherSides.push(s);
    }
  });

  var side = teacherSides.length ? {
    entity: E_TEACHER,
    multi: teacherSides.map(function (s) { return { before: s.before, after: s.after }; })
  } : null;

  appendRows_(SH.log, LOG_FIELDS, [{
    id: logId, timestamp: nowIso_(), action: 'استيراد', entity: E_STUDENT,
    summary_ar: 'استيراد — ' + created.length + ' طالب من ملف إكسيل',
    target_ids: created.map(function (s) { return s.id; }).join(','),
    before_json: safeJson_(snapNone_(created.map(function (s) { return s.id; }))),
    after_json: safeJson_(snapRecords_(stamps_(created))),
    side_effects_json: side ? safeJson_(side) : '',
    undone: 'لا', undone_at: '', undo_of: ''
  }]);

  return ok_({
    added_count: created.length,
    skipped: skipped,
    students: created.map(function (s) { return pick_(s, STUDENT_FIELDS); }),
    log_id: logId
  });
}

function actBulkUpdate_(ids, field, value) {
  if (!ids || !ids.length) return err_(400, 'لم يتم تحديد أي طالب.');
  if (BULK_EDITABLE.indexOf(field) < 0) return err_(400, 'لا يمكن التعديل الجماعي لهذا الحقل: ' + field);

  var ctx = loadCtx_();
  var v = asText_(value);

  if (field === 'level'      && !inList_(v, LEVELS))     return err_(400, 'مستوى غير معروف: ' + v);
  if (field === 'uni_status' && !inList_(v, UNI_STATUS)) return err_(400, 'حالة جامعية غير معروفة: ' + v);
  if (field === 'enrolled'   && !inList_(v, YES_NO))     return err_(400, 'القيمة يجب أن تكون (نعم) أو (لا).');
  if (field === 'year'       && v && !inList_(v, YEARS)) return err_(400, 'سنة غير معروفة: ' + v);
  if (field === 'mentor'     && !findTeacherByName_(ctx, v)) return err_(400, 'المعلم غير موجود: ' + v);

  var now = nowIso_();
  var before = [], after = [], failed = [], teacherSides = [];
  var logId = newId_('log');

  for (var i = 0; i < ids.length; i++) {
    var cur = ctx.students.byId[ids[i]];
    if (!cur) { failed.push({ id: ids[i], reason: 'الطالب غير موجود' }); continue; }

    if (field === 'level' && cur.level === 'معلم' && v !== 'معلم') {
      var blocked = guardAutoTeacher_(ctx, cur);
      if (blocked) { failed.push({ id: cur.id, name: cur.name, reason: blocked.message }); continue; }
    }
    if (field === 'enrolled' && v === 'نعم' && !cur.year) {
      failed.push({ id: cur.id, name: cur.name, reason: 'السنة بالمعهد مطلوبة — عدّلها أولاً' });
      continue;
    }

    before.push({ id: cur.id, updated_at: cur.updated_at, __f: field, __v: cur[field],
                  year: cur.year });

    cur[field] = v;
    if (field === 'enrolled' && v === 'لا') cur.year = '';
    cur.updated_at = now;
    writeRow_(SH.students, STUDENT_FIELDS, cur._row, cur);
    after.push({ id: cur.id, updated_at: now });

    if (field === 'level') {
      if (v === 'معلم') { var s = ensureAutoTeacher_(ctx, cur); if (s) teacherSides.push(s); }
      else if (before[before.length - 1].__v === 'معلم') {
        var rem = removeAutoTeacher_(ctx, cur, logId);
        if (rem) teacherSides.push(rem);
      }
    }
  }

  if (!before.length) return err_(400, 'لم يتم تعديل أي سجل.', { failed: failed });

  // نحوّل اللقطة المضغوطة إلى سجلات جزئية قابلة للتطبيق عند التراجع
  var beforeRecords = before.map(function (b) {
    var r = { id: b.id, updated_at: b.updated_at };
    r[b.__f] = b.__v;
    if (b.__f === 'enrolled') r.year = b.year;
    return r;
  });

  var side = teacherSides.length ? { entity: E_TEACHER, multi: teacherSides.map(function (s) {
    return { before: s.before, after: s.after };
  }) } : null;

  appendRows_(SH.log, LOG_FIELDS, [{
    id: logId, timestamp: nowIso_(), action: 'تعديل جماعي', entity: E_STUDENT,
    summary_ar: 'تعديل جماعي — ' + before.length + ' طالب: ' + fieldLabel_(field) + ' ← (' + v + ')',
    target_ids: before.map(function (b) { return b.id; }).join(','),
    before_json: safeJson_(snapRecords_(beforeRecords)),
    after_json: safeJson_(snapRecords_(after)),
    side_effects_json: side ? safeJson_(side) : '',
    undone: 'لا', undone_at: '', undo_of: ''
  }]);

  return ok_({ updated_count: before.length, failed: failed, log_id: logId });
}

function fieldLabel_(f) {
  return ({ level: 'المستوى', mentor: 'المعلم المتابع', uni_status: 'الحالة الجامعية',
            enrolled: 'مسجل بالمعهد', year: 'السنة بالمعهد' })[f] || f;
}

function actBulkDelete_(ids) {
  if (!ids || !ids.length) return err_(400, 'لم يتم تحديد أي طالب.');
  var ctx = loadCtx_();
  var logId = newId_('log');
  var toArchive = [], rows = [], blocked = [], deleted = [], teacherSides = [];

  for (var i = 0; i < ids.length; i++) {
    var cur = ctx.students.byId[ids[i]];
    if (!cur) { blocked.push({ id: ids[i], reason: 'الطالب غير موجود' }); continue; }
    var guard = guardAutoTeacher_(ctx, cur);
    if (guard) { blocked.push({ id: cur.id, name: cur.name, reason: guard.message }); continue; }
    toArchive.push(pick_(cur, STUDENT_FIELDS));
    rows.push(cur._row);
    deleted.push(cur);
  }

  if (!deleted.length) return err_(400, 'لم يتم حذف أي سجل.', { blocked: blocked });

  archiveRecords_(E_STUDENT, toArchive, logId);
  deleteRows_(SH.students, rows);
  var deletedIds = {};
  deleted.forEach(function (d) { deletedIds[d.id] = true; });
  ctx.students.rows = ctx.students.rows.filter(function (s) { return !deletedIds[s.id]; });

  deleted.forEach(function (d) {
    var rem = removeAutoTeacher_(ctx, d, logId);
    if (rem) teacherSides.push(rem);
  });

  var side = teacherSides.length ? { entity: E_TEACHER, multi: teacherSides.map(function (s) {
    return { before: s.before, after: s.after };
  }) } : null;

  appendRows_(SH.log, LOG_FIELDS, [{
    id: logId, timestamp: nowIso_(), action: 'حذف جماعي', entity: E_STUDENT,
    summary_ar: 'حذف جماعي — ' + deleted.length + ' طالب',
    target_ids: deleted.map(function (d) { return d.id; }).join(','),
    before_json: safeJson_(snapArchive_(deleted.map(function (d) { return d.id; }))),
    after_json: safeJson_(snapNone_(deleted.map(function (d) { return d.id; }))),
    side_effects_json: side ? safeJson_(side) : '',
    undone: 'لا', undone_at: '', undo_of: ''
  }]);

  return ok_({ deleted_count: deleted.length, blocked: blocked, log_id: logId });
}


/* ==========================================================================
 * 11) عمليات المعلمين
 * ========================================================================== */

function actCreateTeacher_(raw) {
  var ctx = loadCtx_();
  var name = asText_(raw && raw.name);
  var phone = normPhone_(raw && raw.phone);

  if (normText_(name).length < 2) return err_(400, 'اسم المعلم مطلوب.');
  if (!isValidPhone_(phone))      return err_(400, 'رقم هاتف المعلم غير صالح.');
  if (findTeacherByName_(ctx, name)) return err_(400, 'يوجد معلم مسجل بنفس الاسم: ' + name);

  var now = nowIso_();
  var t = {
    id: newId_('tch'), name: name, phone: phone, source: 'يدوي', student_id: '',
    notes: asText_(raw && raw.notes), created_at: now, updated_at: now
  };
  appendRows_(SH.teachers, TEACHER_FIELDS, [t]);

  var logId = writeLog_('إضافة', E_TEACHER, 'إضافة معلم: ' + t.name, [t.id],
                        snapNone_([t.id]), snapRecords_(stamps_([t])), null);

  return ok_({ teacher: pick_(t, TEACHER_FIELDS), log_id: logId });
}

function actUpdateTeacher_(raw) {
  var ctx = loadCtx_();
  var cur = ctx.teachers.byId[raw && raw.id];
  if (!cur) return err_(404, 'المعلم غير موجود.');
  if (raw.expected_updated_at && raw.expected_updated_at !== cur.updated_at) {
    return err_(409, 'تم تعديل بيانات هذا المعلم بواسطة مشرف آخر.');
  }

  var name = asText_(raw.name), phone = normPhone_(raw.phone);
  if (normText_(name).length < 2) return err_(400, 'اسم المعلم مطلوب.');
  if (!isValidPhone_(phone))      return err_(400, 'رقم هاتف المعلم غير صالح.');

  var clash = findTeacherByName_(ctx, name);
  if (clash && clash.id !== cur.id) return err_(400, 'يوجد معلم آخر بنفس الاسم: ' + name);

  var before = pick_(cur, TEACHER_FIELDS);
  var oldName = cur.name;
  cur.name = name;
  cur.phone = phone;
  cur.notes = asText_(raw.notes);
  cur.updated_at = nowIso_();
  writeRow_(SH.teachers, TEACHER_FIELDS, cur._row, cur);

  var cascade = cascadeRename_(ctx, oldName, name);
  var side = cascade ? { entity: E_STUDENT, before: cascade.before, after: cascade.after } : null;

  var logId = writeLog_('تعديل', E_TEACHER,
    'تعديل معلم: ' + oldName + (oldName !== name ? ' ← ' + name : '') +
    (cascade ? ' (تم تحديث ' + cascade.ids.length + ' طالب)' : ''),
    [cur.id], snapRecords_([before]), snapRecords_(stamps_([cur])), side);

  return ok_({ teacher: pick_(cur, TEACHER_FIELDS), cascaded: cascade ? cascade.ids.length : 0, log_id: logId });
}

function actDeleteTeacher_(id) {
  var ctx = loadCtx_();
  var cur = ctx.teachers.byId[id];
  if (!cur) return err_(404, 'المعلم غير موجود.');

  var m = countMentees_(ctx, cur.name);
  if (m.count > 0) {
    return err_(428,
      'لا يمكن حذف هذا المعلم لأنه متابع لـ ' + m.count + ' طلاب. انقل الطلاب لمعلم آخر أولاً.',
      { students_count: m.count, student_names: m.names });
  }
  if (cur.source === 'تلقائي' && cur.student_id) {
    return err_(428,
      'هذا المعلم مرتبط بطالب مستواه (معلم). غيّر مستوى الطالب بدلاً من حذف المعلم.',
      { student_id: cur.student_id });
  }

  var logId = newId_('log');
  archiveRecords_(E_TEACHER, [pick_(cur, TEACHER_FIELDS)], logId);
  deleteRows_(SH.teachers, [cur._row]);

  appendRows_(SH.log, LOG_FIELDS, [{
    id: logId, timestamp: nowIso_(), action: 'حذف', entity: E_TEACHER,
    summary_ar: 'حذف معلم: ' + cur.name,
    target_ids: cur.id,
    before_json: safeJson_(snapArchive_([cur.id])),
    after_json: safeJson_(snapNone_([cur.id])),
    side_effects_json: '', undone: 'لا', undone_at: '', undo_of: ''
  }]);

  return ok_({ id: id, deleted: true, log_id: logId });
}


/* ==========================================================================
 * 12) التراجع والاسترجاع
 * ========================================================================== */

function actUndo_(logId, force) {
  var logT = readTable_(SH.log, LOG_FIELDS);
  var entry = logT.byId[logId];
  if (!entry) return err_(404, 'العملية غير موجودة في السجل.');
  if (entry.undone === 'نعم') return err_(410, 'لا يمكن التراجع: تم التراجع عن هذه العملية من قبل.');

  var ts = Date.parse(entry.timestamp) || 0;
  if (ts < Date.now() - LOG_RETENTION_DAYS * 24 * 3600 * 1000) {
    return err_(410, 'لا يمكن التراجع: مضى على هذه العملية أكثر من ' + LOG_RETENTION_DAYS + ' يوماً.');
  }

  var before = parseJson_(entry.before_json);
  var after  = parseJson_(entry.after_json);
  if (!before || before.mode === 'too_large' || !after || after.mode === 'too_large') {
    return err_(410, 'لا يمكن التراجع: بيانات هذه العملية أكبر من أن تُحفظ للتراجع.');
  }

  var mainEntity = entry.entity || E_STUDENT;
  var res = applySnapshot_(mainEntity, before, after, force);

  // عكس الآثار الجانبية (مزامنة المعلمين / إعادة التسمية المتتالية)
  var side = parseJson_(entry.side_effects_json);
  if (side && side.mode !== 'too_large') {
    var sideList = side.multi ? side.multi : [side];
    for (var i = 0; i < sideList.length; i++) {
      var s = sideList[i];
      if (!s || !s.before || !s.after) continue;
      applySnapshot_(side.entity || s.entity || E_TEACHER, s.before, s.after, true);
    }
    if (side.cascade) applySnapshot_(E_STUDENT, side.cascade.before, side.cascade.after, true);
  }

  // تعليم العملية كمتراجَع عنها
  entry.undone = 'نعم';
  entry.undone_at = nowIso_();
  writeRow_(SH.log, LOG_FIELDS, entry._row, entry);

  // تسجيل التراجع نفسه كعملية قابلة للتراجع (أي إعادة تنفيذ)
  var undoLogId = writeLog_('تراجع', mainEntity,
    'تراجع عن: ' + entry.summary_ar, res.ids,
    res.inverseBefore, res.inverseAfter, null, entry.id);

  return ok_({
    restored_count: res.ids.length,
    skipped: res.skipped,
    log_id: undoLogId,
    message: res.skipped.length
      ? 'تم التراجع عن ' + res.ids.length + ' من ' + (res.ids.length + res.skipped.length) + ' — راجع المستثنى'
      : 'تم التراجع عن: ' + entry.summary_ar
  });
}

/**
 * قلب آلية التراجع.
 * يعيد تطبيق before ويتحقق أن الوضع الحالي ما زال مطابقاً لـ after.
 * يعيد { ids, skipped, inverseBefore, inverseAfter } لتسجيل عملية التراجع.
 */
function applySnapshot_(entity, before, after, force) {
  var isStudent = entity === E_STUDENT;
  var isTemplate = entity === 'قالب';
  var sheetName = isStudent ? SH.students : (isTemplate ? SH.templates : SH.teachers);
  var fields    = isStudent ? STUDENT_FIELDS : (isTemplate ? TEMPLATE_FIELDS : TEACHER_FIELDS);
  var t = readTable_(sheetName, fields);

  var done = [], skipped = [], now = nowIso_();
  var afterStamps = {};
  (after && after.records ? after.records : []).forEach(function (r) { afterStamps[r.id] = r.updated_at; });

  // (أ) كان غير موجود ← نؤرشف ما أُنشئ
  if (before.mode === 'none') {
    var ids = (after && after.records) ? after.records.map(function (r) { return r.id; }) : (after.ids || []);
    var toArchive = [], rows = [];
    ids.forEach(function (id) {
      var cur = t.byId[id];
      if (!cur) { skipped.push({ id: id, reason: 'السجل غير موجود أصلاً' }); return; }
      if (!force && afterStamps[id] && cur.updated_at !== afterStamps[id]) {
        skipped.push({ id: id, name: cur.name, reason: 'تم تعديل هذا السجل بعد العملية' });
        return;
      }
      toArchive.push(pick_(cur, fields));
      rows.push(cur._row);
      done.push(id);
    });
    if (toArchive.length) {
      archiveRecords_(entity, toArchive, 'undo');
      deleteRows_(sheetName, rows);
    }
    return { ids: done, skipped: skipped,
             inverseBefore: snapArchive_(done), inverseAfter: snapNone_(done) };
  }

  // (ب) كان محذوفاً في الأرشيف ← نسترجعه
  if (before.mode === 'archive') {
    var wanted = before.ids || [];
    var popped = popFromArchive_(entity, wanted);
    var restored = [], back = [];
    popped.forEach(function (a) {
      var rec = pick_(a, fields);
      if (isStudent) {
        var dup = null;
        var pool = t.rows.concat(restored);           // يشمل ما استُرجع للتو في نفس العملية
        for (var i = 0; i < pool.length; i++) {
          if (normPhone_(pool[i].phone) === normPhone_(rec.phone)) { dup = pool[i]; break; }
        }
        if (dup) {
          skipped.push({ id: rec.id, name: rec.name, reason: 'رقم الهاتف مسجل الآن للطالب: ' + dup.name });
          archiveRecords_(entity, [rec], 'undo-conflict');   // نعيده للأرشيف كما كان
          return;
        }
      }
      rec.updated_at = now;
      restored.push(rec);
      back.push({ id: rec.id, updated_at: now });
      done.push(rec.id);
    });
    if (restored.length) appendRows_(sheetName, fields, restored);
    return { ids: done, skipped: skipped,
             inverseBefore: snapNone_(done), inverseAfter: snapRecords_(back) };
  }

  // (ج) سجلات (كاملة أو جزئية) ← ندمجها فوق الحالي
  var recs = before.records || [];
  var overwritten = [], newStamps = [];
  recs.forEach(function (rec) {
    var cur = t.byId[rec.id];
    if (!cur) { skipped.push({ id: rec.id, reason: 'السجل غير موجود (ربما حُذف)' }); return; }
    if (!force && afterStamps[rec.id] && cur.updated_at !== afterStamps[rec.id]) {
      skipped.push({ id: rec.id, name: cur.name, reason: 'تم تعديل هذا السجل بعد العملية' });
      return;
    }
    var prev = { id: cur.id, updated_at: cur.updated_at };
    Object.keys(rec).forEach(function (k) {
      if (k === 'id' || k === 'updated_at' || k === '_row') return;
      if (fields.indexOf(k) < 0) return;
      prev[k] = cur[k];
      cur[k] = rec[k];
    });
    cur.updated_at = now;
    writeRow_(sheetName, fields, cur._row, cur);
    overwritten.push(prev);
    newStamps.push({ id: cur.id, updated_at: now });
    done.push(cur.id);
  });

  return { ids: done, skipped: skipped,
           inverseBefore: snapRecords_(overwritten), inverseAfter: snapRecords_(newStamps) };
}

function parseJson_(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

/** استرجاع سجل واحد من شاشة الأرشيف مباشرة */
function actRestore_(id) {
  var t = readTable_(SH.archive, ARCHIVE_FIELDS);
  var target = null;
  for (var i = t.rows.length - 1; i >= 0; i--) { if (t.rows[i].id === id) { target = t.rows[i]; break; } }
  if (!target) return err_(404, 'السجل غير موجود في الأرشيف.');

  var entity = target.entity === E_TEACHER ? E_TEACHER : (target.entity === 'قالب' ? 'قالب' : E_STUDENT);
  var res = applySnapshot_(entity, snapArchive_([id]), snapNone_([id]), false);
  if (!res.ids.length) {
    return err_(410, (res.skipped[0] && res.skipped[0].reason) || 'تعذّر الاسترجاع.');
  }

  var logId = writeLog_('استرجاع', entity, 'استرجاع من الأرشيف: ' + target.name, res.ids,
                        res.inverseBefore, res.inverseAfter, null);
  return ok_({ restored: res.ids, log_id: logId });
}


/* ==========================================================================
 * 13) الصيانة الدورية (اختياري)
 * --------------------------------------------------------------------------
 * لتفعيل التنظيف التلقائي: Triggers ← Add Trigger ← dailyMaintenance ← Day timer
 * ========================================================================== */

function dailyMaintenance() {
  withLock_(function () { cleanOldLogs_(); return ok_({}); });
}

/* ==========================================================================
 * 14) إدارة القوالب المحفوظة والأرشفة
 * ========================================================================== */

function actSaveTemplate_(name, content, query) {
  if (!name || !name.trim()) return err_(400, 'اسم القالب مطلوب.');
  var ctx = loadCtx_();
  var normN = normText_(name.trim());
  var existing = null;
  for (var i = 0; i < ctx.templates.rows.length; i++) {
    if (normText_(ctx.templates.rows[i].name) === normN) {
      existing = ctx.templates.rows[i];
      break;
    }
  }
  var now = nowIso_();
  var qStr = safeJson_(query || {});
  var tObj;
  var beforeSnap = existing ? snapRecords_(stamps_([existing])) : snapNone_([]);
  if (existing) {
    tObj = pick_(existing, TEMPLATE_FIELDS);
    tObj.name = name.trim();
    tObj.content = content || '';
    tObj.query_json = qStr;
    tObj.updated_at = now;
    writeRow_(SH.templates, TEMPLATE_FIELDS, existing._row, tObj);
  } else {
    tObj = {
      id: newId_('tpl'),
      name: name.trim(),
      content: content || '',
      query_json: qStr,
      created_at: now,
      updated_at: now
    };
    appendRows_(SH.templates, TEMPLATE_FIELDS, [tObj]);
  }

  var logId = writeLog_(existing ? 'تعديل' : 'إضافة', 'قالب', (existing ? 'تعديل' : 'إضافة') + ' قالب: ' + tObj.name, [tObj.id],
                        beforeSnap, snapRecords_(stamps_([tObj])), null);

  return ok_({ template: tObj, log_id: logId });
}

function actDeleteTemplate_(idOrName) {
  if (!idOrName) return err_(400, 'معرف القالب مطلوب.');
  var ctx = loadCtx_();
  var target = null;
  var normKey = normText_(idOrName);
  for (var i = 0; i < ctx.templates.rows.length; i++) {
    var row = ctx.templates.rows[i];
    if (row.id === idOrName || normText_(row.name) === normKey) {
      target = row;
      break;
    }
  }
  if (!target) return err_(404, 'القالب غير موجود.');

  var logId = writeLog_('حذف', 'قالب', 'حذف قالب: ' + target.name, [target.id],
                        snapArchive_([target.id]), snapNone_([target.id]), null);

  archiveRecords_('قالب', [pick_(target, TEMPLATE_FIELDS)], logId);
  deleteRows_(SH.templates, [target._row]);

  return ok_({ id: target.id, name: target.name, log_id: logId });
}
