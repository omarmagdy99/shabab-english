// الحالة المركزية: عرض فوري من الكاش المحلي ثم تحديث من الخادم في الخلفية

import { api, ApiError } from './api.js';
import { LS } from './config.js';
import { normText, normPhone } from './normalize.js';
import { showProcessingToast, hideProcessingToast } from './ui.js';

const state = {
  students: [],
  teachers: [],
  templates: [],
  log: [],
  loaded: false,     // هل وصلت بيانات (من الكاش أو الخادم)؟
  syncing: false,
  lastSync: null,
  error: null,
};

const listeners = new Set();
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = () => listeners.forEach((fn) => fn(state));

export const getState = () => state;

/* ---------- الكاش المحلي ---------- */

function readCache() {
  try {
    const raw = localStorage.getItem(LS.cache);
    if (!raw) return null;
    const c = JSON.parse(raw);
    return c && Array.isArray(c.students) ? c : null;
  } catch { return null; }
}

function writeCache() {
  try {
    localStorage.setItem(LS.cache, JSON.stringify({
      students: state.students, teachers: state.teachers,
      templates: state.templates, log: state.log, lastSync: state.lastSync,
    }));
  } catch { /* الكاش ممتلئ — نتجاهل */ }
}

export function clearCache() {
  localStorage.removeItem(LS.cache);
  Object.assign(state, { students: [], teachers: [], templates: [], log: [], loaded: false, lastSync: null });
  emit();
}

/* ---------- التحميل والتحديث ---------- */

export function hydrateFromCache() {
  const c = readCache();
  if (!c) return false;
  Object.assign(state, { students: c.students, teachers: c.teachers, templates: c.templates || [], log: c.log || [], lastSync: c.lastSync, loaded: true });
  emit();
  return true;
}

export async function refresh({ silent = false } = {}) {
  state.syncing = true;
  state.error = null;
  if (!silent) {
    showProcessingToast('جاري تحديث البيانات...');
    emit();
  }
  try {
    const data = await api.list();
    Object.assign(state, {
      students: data.students || [],
      teachers: data.teachers || [],
      templates: data.templates || [],
      log: data.log || [],
      loaded: true,
      lastSync: new Date().toISOString(),
    });
    writeCache();
    return state;
  } catch (e) {
    state.error = e instanceof ApiError ? e : new ApiError({ message: String(e) });
    throw state.error;
  } finally {
    state.syncing = false;
    if (!silent) hideProcessingToast();
    emit();
  }
}

/**
 * ينفّذ عملية كتابة ثم يعيد التحميل مع إظهار إشعار جاري العمل تلقائياً
 */
export async function mutate(fn) {
  showProcessingToast('جاري تنفيذ العمليّة...');
  try {
    const result = await fn();
    await refresh({ silent: true });
    return result;
  } finally {
    hideProcessingToast();
  }
}

/* ---------- مساعدات مشتقة ---------- */

export const teacherNames = () => state.teachers.map((t) => t.name);

export const menteeCount = (teacherName) => {
  const n = normText(teacherName);
  return state.students.filter((s) => normText(s.mentor) === n).length;
};

export const teachersWithCounts = () =>
  state.teachers.map((t) => ({ ...t, mentees: menteeCount(t.name) }));

export const findStudentByPhone = (phone, excludeId = null) => {
  const p = normPhone(phone);
  return state.students.find((s) => s.id !== excludeId && normPhone(s.phone) === p) || null;
};
