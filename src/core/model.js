import { randomUUID } from 'node:crypto';

export const uid = () => randomUUID();
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export const blankState = () => ({ schemaVersion: 1, tasks: [], templates: [], sessions: [], active: null, settings: { sound: true, fullscreenHintSeen: false } });
export const actualMs = (state, taskId) => state.sessions.reduce((n, s) => n + (s.taskId === taskId ? s.elapsedMs : 0), 0);
export function summary(state, date) {
  const tasks = state.tasks.filter(t => t.date === date);
  return tasks.reduce((s, t) => {
    const a = actualMs(state, t.id);
    return { count: s.count + 1, completed: s.completed + Number(t.completed), budgetMs: s.budgetMs + t.budgetMs, actualMs: s.actualMs + a, overtimeMs: s.overtimeMs + Math.max(0, a - t.budgetMs) };
  }, { count: 0, completed: 0, budgetMs: 0, actualMs: 0, overtimeMs: 0 });
}

export function validateDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期格式不正确');
  const d = new Date(`${value}T12:00:00`);
  if (!Number.isFinite(d.getTime()) || localDate(d) !== value) throw new Error('日期无效');
  return value;
}
const text = (value, max, label) => {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label}格式或长度不正确`);
  return value;
};
const bool = value => { if (typeof value !== 'boolean') throw new Error('布尔字段无效'); };
const number = (value, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isFinite(value) || value < 0 || value > max) throw new Error('用时数据无效');
};
export function taskFields(input) {
  const title = text(input.title, 200, '任务名称').trim();
  if (!title) throw new Error('请填写任务名称');
  number(input.budgetMs, 7 * 24 * 3600000);
  if (input.budgetMs < 1000) throw new Error('预计时长至少为 1 秒');
  if (!['high', 'medium', 'low'].includes(input.priority)) throw new Error('优先级无效');
  const notes = text(input.notes ?? '', 20000, '备注');
  if (!Array.isArray(input.subtasks) || input.subtasks.length > 100) throw new Error('子任务最多为 100 项');
  const subtasks = input.subtasks.map(s => ({ id: s.id || uid(), title: text(s.title, 200, '子任务').trim(), done: Boolean(s.done) })).filter(s => s.title);
  if (new Set(subtasks.map(s => s.id)).size !== subtasks.length) throw new Error('子任务标识重复');
  return { title, budgetMs: input.budgetMs, priority: input.priority, notes, subtasks };
}

// Validate the entire graph before replacing any live data. No partial imports.
export function validateState(data) {
  if (!data || data.schemaVersion !== 1) throw new Error('不支持的备份版本');
  for (const key of ['tasks', 'templates', 'sessions']) if (!Array.isArray(data[key]) || data[key].length > 100000) throw new Error('备份结构无效');
  const ids = new Set();
  const identity = id => { text(id, 100, '标识'); if (!id || ids.has(id)) throw new Error('备份标识重复或为空'); ids.add(id); };
  const validFields = x => {
    taskFields(x);
    for (const s of x.subtasks) { identity(s.id); bool(s.done); if (!s.title.trim()) throw new Error('子任务为空'); }
    text(x.createdAt, 100, '创建时间');
    if (!Number.isFinite(Date.parse(x.createdAt))) throw new Error('创建时间无效');
  };
  for (const t of data.templates) { identity(t.id); validFields(t); bool(t.enabled); validateDate(t.startDate); }
  const templateIds = new Set(data.templates.map(t => t.id));
  const dailyIds = new Set();
  for (const t of data.tasks) {
    identity(t.id); validFields(t); validateDate(t.date);
    bool(t.completed); bool(t.archived); bool(t.alerted);
    if (t.templateId !== null && !templateIds.has(t.templateId)) throw new Error('任务的模板引用无效');
    if (t.templateId) { const key = `${t.templateId}:${t.date}`; if (dailyIds.has(key)) throw new Error('每日实例重复'); dailyIds.add(key); }
  }
  const tasks = new Map(data.tasks.map(t => [t.id, t]));
  const open = [];
  for (const s of data.sessions) {
    identity(s.id);
    if (!tasks.has(s.taskId)) throw new Error('计时记录缺少所属任务');
    number(s.elapsedMs);
    if (!Number.isFinite(Date.parse(s.startedAt)) || (s.endedAt !== null && !Number.isFinite(Date.parse(s.endedAt)))) throw new Error('计时记录日期无效');
    if (s.endedAt === null) open.push(s);
  }
  bool(data.settings?.sound); bool(data.settings?.fullscreenHintSeen);
  if (data.active !== null) {
    const a = data.active;
    bool(a.paused);
    if (open.length !== 1 || open[0].id !== a.sessionId || open[0].taskId !== a.taskId || tasks.get(a.taskId)?.completed || tasks.get(a.taskId)?.archived) throw new Error('活动计时记录无效');
  } else if (open.length) throw new Error('存在孤立的活动计时记录');
  return structuredClone(data);
}

export function decodeBackup(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('文件不是有效的 JSON 备份'); }
  if (value?.format !== 'shiguang-focus-backup') throw new Error('请选择拾光专注导出的备份文件');
  return validateState(value.data);
}
