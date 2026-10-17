import { actualMs, blankState, localDate, taskFields, uid, validateDate, validateState } from './model.js';

export class FocusEngine {
  constructor(state = blankState(), { monotonic = () => performance.now(), wall = () => new Date() } = {}) {
    this.state = validateState(state);
    this.monotonic = monotonic;
    this.wall = wall;
    this.anchor = monotonic();
    this.alertPending = false;
    // A checkpoint never counts time during shutdown or crash recovery.
    if (this.state.active) this.state.active.paused = true;
    this.ensureToday();
  }
  snapshot() { return structuredClone(this.state); }
  task(id) { const t = this.state.tasks.find(t => t.id === id); if (!t) throw new Error('任务不存在'); return t; }
  tick() {
    const now = this.monotonic();
    const delta = Math.max(0, now - this.anchor);
    this.anchor = now;
    const a = this.state.active;
    if (!a || a.paused) return false;
    this.state.sessions.find(s => s.id === a.sessionId).elapsedMs += delta;
    const t = this.task(a.taskId);
    if (!t.alerted && actualMs(this.state, t.id) >= t.budgetMs) { t.alerted = true; this.alertPending = true; return true; }
    return false;
  }
  now() { return this.wall().toISOString(); }
  fromTemplate(template, date) {
    return { ...taskFields(template), id: uid(), date, templateId: template.id, subtasks: template.subtasks.map(s => ({ ...s, id: uid(), done: false })), completed: false, archived: false, alerted: false, createdAt: this.now() };
  }
  ensureToday() {
    const date = localDate(this.wall());
    let changed = false;
    for (const t of this.state.templates) {
      if (t.enabled && t.startDate <= date && !this.state.tasks.some(x => x.templateId === t.id && x.date === date)) {
        this.state.tasks.push(this.fromTemplate(t, date)); changed = true;
      }
    }
    return changed;
  }
  pause() { this.tick(); if (this.state.active) this.state.active.paused = true; }
  end() {
    this.tick();
    if (!this.state.active) return;
    this.state.sessions.find(s => s.id === this.state.active.sessionId).endedAt = this.now();
    this.state.active = null;
  }
  dispatch(command) {
    this.tick();
    const { type, id } = command;
    switch (type) {
      case 'create': {
        const fields = taskFields(command.fields);
        const date = validateDate(command.date);
        let templateId = null;
        if (command.repeat) {
          const template = { ...fields, subtasks: fields.subtasks.map(s => ({ ...s, id: uid(), done: false })), id: uid(), enabled: true, startDate: localDate(this.wall()), createdAt: this.now() };
          templateId = template.id; this.state.templates.push(template);
        }
        this.state.tasks.push({ ...fields, id: uid(), date, templateId, completed: false, archived: false, alerted: false, createdAt: this.now() });
        this.ensureToday(); break;
      }
      case 'edit': {
        const t = this.task(id), fields = taskFields(command.fields);
        if (this.state.sessions.some(s => s.taskId === id) && fields.budgetMs !== t.budgetMs) throw new Error('开始过的任务已固定预计时长');
        Object.assign(t, fields); break;
      }
      case 'start': {
        const t = this.task(id);
        if (t.completed || t.archived) throw new Error('请先取消完成或恢复归档任务');
        if (this.state.active?.taskId === id) { this.state.active.paused = false; break; }
        if (this.state.active && !command.confirmSwitch) throw new Error('已有计时任务，请确认切换');
        this.end();
        const session = { id: uid(), taskId: id, elapsedMs: 0, startedAt: this.now(), endedAt: null };
        this.state.sessions.push(session);
        this.state.active = { taskId: id, sessionId: session.id, paused: false };
        this.anchor = this.monotonic(); break;
      }
      case 'pause': this.pause(); break;
      case 'resume': if (this.state.active) { this.state.active.paused = false; this.anchor = this.monotonic(); } break;
      case 'end': this.end(); break;
      case 'complete': {
        const t = this.task(id);
        if (command.completed && t.subtasks.some(s => !s.done) && !command.confirmSubtasks) throw new Error('还有未完成的子任务，请确认');
        if (this.state.active?.taskId === id) this.end();
        t.completed = Boolean(command.completed); break;
      }
      case 'subtask': {
        const s = this.task(id).subtasks.find(s => s.id === command.subtaskId);
        if (!s) throw new Error('子任务不存在'); s.done = Boolean(command.done); break;
      }
      case 'archive': {
        const t = this.task(id);
        if (this.state.active?.taskId === id) this.end();
        t.archived = true; break;
      }
      case 'restore': this.task(id).archived = false; break;
      case 'reorder': {
        const date = validateDate(command.date);
        const old = this.state.tasks.filter(t => t.date === date);
        if (!Array.isArray(command.ids) || command.ids.length !== old.length || new Set(command.ids).size !== old.length || command.ids.some(id => !old.some(t => t.id === id))) throw new Error('排序数据已过期，请重试');
        const ordered = command.ids.map(id => old.find(t => t.id === id));
        this.state.tasks = this.state.tasks.map(t => t.date === date ? ordered.shift() : t); break;
      }
      case 'template': {
        const t = this.state.templates.find(t => t.id === id);
        if (!t) throw new Error('模板不存在');
        Object.assign(t, taskFields(command.fields));
        t.subtasks = t.subtasks.map(s => ({ ...s, done: false }));
        break;
      }
      case 'templateEnabled': {
        const t = this.state.templates.find(t => t.id === id);
        if (!t) throw new Error('模板不存在'); t.enabled = Boolean(command.enabled); this.ensureToday(); break;
      }
      case 'settings':
        if (typeof command.sound === 'boolean') this.state.settings.sound = command.sound;
        if (typeof command.fullscreenHintSeen === 'boolean') this.state.settings.fullscreenHintSeen = command.fullscreenHintSeen;
        break;
      default: throw new Error('不支持的操作');
    }
    return this.snapshot();
  }
}
