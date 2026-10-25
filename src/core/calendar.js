export function localDate(date = new Date()) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validateDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期格式不正确');
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('日期无效');
  return value;
}
// Calendar arithmetic must not depend on the length of a local DST day.
export const dayNumber = date => Date.parse(`${validateDate(date)}T00:00:00Z`) / 86400000;
export function dateFromDay(day) {
  const date = new Date(day * 86400000).toISOString().slice(0, 10);
  return /^\d{4}-/.test(date) ? date : null;
}
export const weekday = date => new Date(`${validateDate(date)}T12:00:00Z`).getUTCDay() || 7;
