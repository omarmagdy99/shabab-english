// طبقة الاتصال بـ Google Apps Script
// كل الطلبات POST بصيغة text/plain لتفادي طلب CORS Preflight

import { WEB_APP_URL, LS } from './config.js';

export class ApiError extends Error {
  constructor({ code, message, data }) {
    super(message || 'حدث خطأ غير متوقع.');
    this.code = code || 0;
    this.data = data || null;
  }
}

export const getPass = () => localStorage.getItem(LS.pass) || '';
export const setPass = (p) => localStorage.setItem(LS.pass, p);
export const clearPass = () => localStorage.removeItem(LS.pass);

export async function call(action, payload = {}, { pass } = {}) {
  let res;
  try {
    res = await fetch(WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, pass: pass ?? getPass(), ...payload }),
    });
  } catch {
    throw new ApiError({ code: 0, message: 'تعذّر الاتصال بالخادم. تأكد من الإنترنت وحاول مرة أخرى.' });
  }

  let json;
  try {
    json = await res.json();
  } catch {
    throw new ApiError({ code: res.status, message: 'رد غير مفهوم من الخادم. تأكد من نشر السكريبت بشكل صحيح.' });
  }

  if (json.status === 'error') throw new ApiError(json);
  return json.data;
}

export const api = {
  list:          ()                      => call('list'),
  listArchive:   ()                      => call('listArchive'),
  create:        (student)               => call('create', { student }),
  update:        (student)               => call('update', { student }),
  remove:        (id, expected)          => call('delete', { id, expected_updated_at: expected }),
  bulkCreate:    (students)              => call('bulkCreate', { students }),
  bulkUpdate:    (ids, field, value)     => call('bulkUpdate', { ids, field, value }),
  bulkDelete:    (ids)                   => call('bulkDelete', { ids }),
  createTeacher: (teacher)               => call('createTeacher', { teacher }),
  updateTeacher: (teacher)               => call('updateTeacher', { teacher }),
  deleteTeacher: (id)                    => call('deleteTeacher', { id }),
  undo:          (log_id, force = false) => call('undo', { log_id, force }),
  restore:       (id)                    => call('restore', { id }),
  saveTemplate:   (name, content, query)  => call('saveTemplate', { name, content, query }),
  deleteTemplate: (idOrName)              => call('deleteTemplate', { id: idOrName }),
};
