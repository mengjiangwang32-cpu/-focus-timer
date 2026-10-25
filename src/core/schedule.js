import { dateFromDay, dayNumber, validateDate, weekday } from './calendar.js';

export const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export function validateSchedule(value) {
  if (!value || typeof value !== 'object') throw new Error('重复规则无效');
  switch (value.kind) {
    case 'daily': return { kind: 'daily' };
    case 'weekly': {
      if (!Array.isArray(value.weekdays) || !value.weekdays.length || value.weekdays.length > 7 || value.weekdays.some(d => !Number.isInteger(d) || d < 1 || d > 7) || new Set(value.weekdays).size !== value.weekdays.length) throw new Error('请至少选择一个有效的星期，且不可重复');
      return { kind: 'weekly', weekdays: [...value.weekdays].sort((a, b) => a - b) };
    }
    case 'interval':
      if (!Number.isInteger(value.everyDays) || value.everyDays < 1 || value.everyDays > 3650) throw new Error('间隔天数须为 1～3650 的整数');
      return { kind: 'interval', everyDays: value.everyDays };
    default: throw new Error('不支持的重复规则');
  }
}
export function isDue(template, date) {
  validateDate(date);
  if (!template.enabled || date < template.startDate) return false;
  const rule = template.schedule;
  if (rule.kind === 'daily') return true;
  if (rule.kind === 'weekly') return rule.weekdays.includes(weekday(date));
  return (dayNumber(date) - dayNumber(template.startDate)) % rule.everyDays === 0;
}
export function nextOccurrences(template, from, count = 3) {
  if (!template.enabled) return [];
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('预览数量无效');
  let day = Math.max(dayNumber(from), dayNumber(template.startDate));
  const rule = validateSchedule(template.schedule);
  if (rule.kind === 'interval') {
    const start = dayNumber(template.startDate);
    day = start + Math.ceil((day - start) / rule.everyDays) * rule.everyDays;
  }
  const result = [];
  while (result.length < count) {
    const date = dateFromDay(day);
    if (!date) break;
    if (isDue(template, date)) result.push(date);
    day += rule.kind === 'interval' ? rule.everyDays : 1;
  }
  return result;
}
export function scheduleLabel(rule) {
  if (rule.kind === 'daily') return '每天一次';
  if (rule.kind === 'weekly') return `每周：${rule.weekdays.map(d => WEEKDAYS[d - 1]).join('、')}`;
  return `每 ${rule.everyDays} 天一次`;
}
