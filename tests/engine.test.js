import test from 'node:test';
import assert from 'node:assert/strict';
import { FocusEngine } from '../src/core/engine.js';
import { actualMs, blankState, decodeBackup, summary, validateState } from '../src/core/model.js';

function fixture() {
  let monotonic = 0, wall = new Date('2026-10-17T10:00:00');
  const options = { monotonic: () => monotonic, wall: () => wall };
  const engine = new FocusEngine(blankState(), options);
  return {
    engine, options,
    advance: ms => { monotonic += ms; wall = new Date(wall.getTime() + ms); return engine.tick(); },
    setWall: date => { wall = new Date(date); },
    add: (override = {}, repeat = false) => { engine.dispatch({ type: 'create', date: '2026-10-17', repeat, fields: { title: '阅读', budgetMs: 20 * 60000, priority: 'medium', notes: '一段安静的时光', subtasks: [], ...override } }); return engine.state.tasks.at(-1); },
    start: id => engine.dispatch({ type: 'start', id }),
  };
}

test('T02: task details and subtasks survive serialization with stable identifiers', () => {
  const f = fixture();
  const t = f.add({ priority: 'high', subtasks: [{ id: 'sub-1', title: '第一页', done: false }] });
  f.engine.dispatch({ type: 'subtask', id: t.id, subtaskId: 'sub-1', done: true });
  const recovered = new FocusEngine(JSON.parse(JSON.stringify(f.engine.snapshot())), f.options);
  assert.deepEqual(recovered.task(t.id), t);
  assert.equal(recovered.task(t.id).subtasks[0].done, true);
});
test('T04/T18: elapsed derives from monotonic time, including long UI stalls', () => {
  const f = fixture(), t = f.add(); f.start(t.id);
  f.advance(7 * 60000);
  assert.equal(actualMs(f.engine.state, t.id), 7 * 60000);
  f.setWall('2035-02-02T03:00:00'); f.advance(1234);
  assert.equal(actualMs(f.engine.state, t.id), 7 * 60000 + 1234);
  f.setWall('2020-01-01T01:00:00'); f.advance(10);
  assert.equal(actualMs(f.engine.state, t.id), 7 * 60000 + 1244);
});
test('T05: 7m running, 10m paused, 16m running => 23m actual and 3m overtime', () => {
  const f = fixture(), t = f.add(); f.start(t.id); f.advance(7 * 60000);
  f.engine.dispatch({ type: 'pause' }); f.advance(10 * 60000);
  assert.equal(actualMs(f.engine.state, t.id), 7 * 60000);
  f.engine.dispatch({ type: 'resume' }); f.advance(16 * 60000); f.engine.dispatch({ type: 'end' });
  const s = summary(f.engine.state, t.date);
  assert.equal(s.actualMs, 23 * 60000); assert.equal(s.overtimeMs, 3 * 60000);
});
test('T06/T07/T09: alert exactly once, overtime continues, no automatic completion', () => {
  const f = fixture(), t = f.add({ budgetMs: 2000 }); f.start(t.id);
  assert.equal(f.advance(1999), false); assert.equal(f.advance(1), true);
  assert.equal(t.alerted, true); assert.equal(t.completed, false);
  assert.equal(f.advance(5000), false);
  f.engine.dispatch({ type: 'pause' }); f.advance(4000); f.engine.dispatch({ type: 'resume' });
  assert.equal(f.advance(1000), false);
  const restored = new FocusEngine(f.engine.snapshot(), f.options);
  restored.dispatch({ type: 'resume' }); assert.equal(restored.tick(), false);
  assert.equal(actualMs(restored.state, t.id), 8000);
  assert.equal(summary(restored.state, t.date).completed, 0);
});
test('alert at a command boundary is retained for the desktop sound handler', () => {
  let now = 0;
  const e = new FocusEngine(blankState(), { monotonic: () => now });
  e.dispatch({ type: 'create', date: '2026-10-17', fields: { title: '短计时', budgetMs: 1000, priority: 'low', notes: '', subtasks: [] } });
  e.dispatch({ type: 'start', id: e.state.tasks[0].id }); now = 1001;
  e.dispatch({ type: 'pause' }); assert.equal(e.alertPending, true); assert.equal(e.state.tasks[0].alerted, true);
});
test('T08/T21: completing stops the clock; unchecking preserves all sessions', () => {
  const f = fixture(), t = f.add(); f.start(t.id); f.advance(5000);
  f.engine.dispatch({ type: 'complete', id: t.id, completed: true });
  assert.equal(t.completed, true); assert.equal(f.engine.state.active, null); f.advance(10000);
  f.engine.dispatch({ type: 'complete', id: t.id, completed: false });
  assert.equal(actualMs(f.engine.state, t.id), 5000);
  f.start(t.id); f.advance(2000); assert.equal(actualMs(f.engine.state, t.id), 7000);
  assert.equal(f.engine.state.sessions.length, 2);
});
test('T10: two sessions share a single 20m budget (10m + 12m => 2m overtime)', () => {
  const f = fixture(), t = f.add(); f.start(t.id); f.advance(10 * 60000); f.engine.dispatch({ type: 'end' });
  assert.equal(t.completed, false); f.start(t.id); f.advance(12 * 60000);
  assert.equal(summary(f.engine.state, t.date).overtimeMs, 2 * 60000);
});
test('T11: switching requires confirmation and closes the previous session', () => {
  const f = fixture(), a = f.add(), b = f.add({ title: '运动' }); f.start(a.id); f.advance(1234);
  assert.throws(() => f.start(b.id), /确认切换/);
  f.engine.dispatch({ type: 'start', id: b.id, confirmSwitch: true }); f.advance(2000);
  assert.equal(actualMs(f.engine.state, a.id), 1234); assert.equal(actualMs(f.engine.state, b.id), 2000);
  assert.equal(f.engine.state.sessions.filter(s => s.endedAt === null).length, 1);
});
test('T12: manual order persists and priority edits do not reorder', () => {
  const f = fixture(), a = f.add({ title: 'A' }), b = f.add({ title: 'B' }), c = f.add({ title: 'C' });
  f.engine.dispatch({ type: 'reorder', date: a.date, ids: [c.id, a.id, b.id] });
  f.engine.dispatch({ type: 'edit', id: b.id, fields: { ...b, priority: 'high' } });
  const restored = new FocusEngine(f.engine.snapshot(), f.options);
  assert.deepEqual(restored.state.tasks.map(t => t.title), ['C', 'A', 'B']);
  assert.throws(() => restored.dispatch({ type: 'reorder', date: a.date, ids: [a.id] }), /排序数据/);
});
test('T13/T17: daily templates generate once, no missed-day backfill, independent child IDs', () => {
  const f = fixture(), t = f.add({ subtasks: [{ id: 'sub', title: '拉伸', done: false }] }, true);
  f.engine.dispatch({ type: 'subtask', id: t.id, subtaskId: t.subtasks[0].id, done: true }); f.start(t.id); f.advance(3000);
  f.setWall('2026-10-20T00:00:00'); f.engine.ensureToday(); f.engine.ensureToday();
  assert.equal(f.engine.state.tasks.length, 2);
  const next = f.engine.state.tasks[1];
  assert.equal(next.date, '2026-10-20'); assert.equal(next.completed, false); assert.equal(next.subtasks[0].done, false);
  assert.notEqual(next.subtasks[0].id, t.subtasks[0].id); assert.equal(actualMs(f.engine.state, next.id), 0);
  assert.equal(f.engine.state.active.taskId, t.id); assert.equal(t.date, '2026-10-17');
  assert.doesNotThrow(() => validateState(f.engine.snapshot()));
});
test('T14: template edits and disabling preserve snapshots of existing tasks', () => {
  const f = fixture(), old = f.add({}, true), template = f.engine.state.templates[0];
  f.engine.dispatch({ type: 'template', id: template.id, fields: { ...template, title: '新习惯', budgetMs: 300000 } });
  assert.equal(old.title, '阅读'); assert.equal(old.budgetMs, 1200000);
  f.setWall('2026-10-18T10:00:00'); f.engine.ensureToday();
  assert.equal(f.engine.state.tasks[1].title, '新习惯');
  f.engine.dispatch({ type: 'templateEnabled', id: template.id, enabled: false });
  f.setWall('2026-10-19T10:00:00'); f.engine.ensureToday(); assert.equal(f.engine.state.tasks.length, 2);
});
test('T15: statistics count parents, retain archived tasks and unfinished overtime', () => {
  const f = fixture(), a = f.add({ budgetMs: 1000, subtasks: [{ id: 'child', title: '小步骤', done: true }] }), b = f.add({ budgetMs: 2000 });
  f.start(a.id); f.advance(3000); f.engine.dispatch({ type: 'archive', id: a.id });
  f.engine.dispatch({ type: 'complete', id: b.id, completed: true });
  assert.deepEqual(summary(f.engine.state, a.date), { count: 2, completed: 1, budgetMs: 3000, actualMs: 3000, overtimeMs: 2000 });
});
test('T16: normal close and crash checkpoint recover paused without offline accumulation', () => {
  const f = fixture(), t = f.add(); f.start(t.id); f.advance(4321);
  const checkpoint = f.engine.snapshot(); f.advance(1111);
  f.setWall('2026-11-17T10:00:00');
  const restored = new FocusEngine(checkpoint, f.options);
  restored.tick(); assert.equal(restored.state.active.paused, true); assert.equal(actualMs(restored.state, t.id), 4321);
  restored.dispatch({ type: 'resume' }); restored.tick(); assert.equal(actualMs(restored.state, t.id), 4321);
});
test('T17: suspend pauses; resume does not include sleep duration', () => {
  const f = fixture(), t = f.add(); f.start(t.id); f.advance(2500); f.engine.pause(); f.advance(8 * 3600000);
  assert.equal(actualMs(f.engine.state, t.id), 2500); assert.equal(f.engine.state.active.paused, true);
  f.engine.dispatch({ type: 'resume' }); f.advance(500); assert.equal(actualMs(f.engine.state, t.id), 3000);
});
test('T19: complete backup round trip; corrupt or inconsistent backups rejected atomically', () => {
  const f = fixture(), t = f.add({}, true); f.start(t.id); f.advance(2222);
  f.engine.dispatch({ type: 'settings', sound: false });
  const before = f.engine.snapshot(); const raw = JSON.stringify({ format: 'shiguang-focus-backup', data: before });
  assert.deepEqual(decodeBackup(raw), before);
  assert.throws(() => decodeBackup('{broken'), /JSON/);
  const bad = structuredClone(before); bad.sessions[0].taskId = 'missing';
  assert.throws(() => decodeBackup(JSON.stringify({ format: 'shiguang-focus-backup', data: bad })), /所属任务/);
  bad.sessions[0] = { ...before.sessions[0], elapsedMs: -1 };
  assert.throws(() => validateState(bad), /用时数据/);
  assert.deepEqual(f.engine.snapshot(), before);
});
test('reject duplicate IDs, broken active references, duplicate daily instances and malformed fields', () => {
  const f = fixture(), t = f.add({}, true); f.start(t.id);
  const base = f.engine.snapshot();
  const duplicate = structuredClone(base); duplicate.tasks.push(structuredClone(duplicate.tasks[0]));
  assert.throws(() => validateState(duplicate), /重复/);
  const orphan = structuredClone(base); orphan.active = null; assert.throws(() => validateState(orphan), /孤立/);
  const daily = structuredClone(base); daily.tasks.push({ ...daily.tasks[0], id: 'second' }); assert.throws(() => validateState(daily), /每日实例重复/);
  assert.throws(() => f.add({ title: '   ' }), /任务名称/);
  assert.throws(() => f.add({ budgetMs: NaN }), /用时数据/);
  assert.throws(() => f.engine.dispatch({ type: 'create', date: '2026-02-31', fields: t }), /日期无效/);
});
test('budget is immutable after first start; notes and subtasks remain editable', () => {
  const f = fixture(), t = f.add(); f.start(t.id); f.engine.dispatch({ type: 'end' });
  assert.throws(() => f.engine.dispatch({ type: 'edit', id: t.id, fields: { ...t, budgetMs: 1000 } }), /固定/);
  f.engine.dispatch({ type: 'edit', id: t.id, fields: { ...t, notes: '新备注' } }); assert.equal(t.notes, '新备注');
});
test('unfinished subtasks need confirmation; checking all children never completes parent', () => {
  const f = fixture(), t = f.add({ subtasks: [{ id: 'c', title: '子任务', done: false }] });
  assert.throws(() => f.engine.dispatch({ type: 'complete', id: t.id, completed: true }), /子任务/);
  f.engine.dispatch({ type: 'subtask', id: t.id, subtaskId: 'c', done: true }); assert.equal(t.completed, false);
  f.engine.dispatch({ type: 'complete', id: t.id, completed: true }); assert.equal(t.completed, true);
});
test('archiving a daily instance does not cause duplicate regeneration', () => {
  const f = fixture(), t = f.add({}, true);
  f.engine.dispatch({ type: 'archive', id: t.id }); f.engine.ensureToday(); assert.equal(f.engine.state.tasks.length, 1);
  f.engine.dispatch({ type: 'restore', id: t.id }); assert.equal(t.archived, false);
});
