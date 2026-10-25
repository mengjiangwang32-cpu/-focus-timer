import test from 'node:test';
import assert from 'node:assert/strict';
import { FocusEngine } from '../src/core/engine.js';
import { blankState, decodeBackup, validateState } from '../src/core/model.js';
import { dayNumber, weekday } from '../src/core/calendar.js';
import { isDue, nextOccurrences, validateSchedule } from '../src/core/schedule.js';

const fields = { title: '定期运动', budgetMs: 1200000, notes: '保持自己的节奏', priority: 'medium', subtasks: [{ id: 'input-sub', title: '拉伸', done: false }] };
function fixture(schedule, startDate = '2026-10-25') {
  let wall = new Date('2026-10-25T12:00:00');
  const engine = new FocusEngine(blankState(), { wall: () => wall, monotonic: () => 0 });
  engine.dispatch({ type: 'create', date: '2026-10-25', fields, repeat: true, schedule, startDate });
  return { engine, template: engine.state.templates[0], day: date => { wall = new Date(`${date}T12:00:00`); engine.ensureToday(); engine.ensureToday(); } };
}
test('weekly selection generates only Mon/Wed/Fri, once per due date, never on Sunday', () => {
  const f = fixture({ kind: 'weekly', weekdays: [1, 3, 5] });
  assert.equal(f.engine.state.tasks.length, 0);
  for (let i = 26; i <= 31; i++) f.day(`2026-10-${i}`);
  f.day('2026-11-01');
  assert.deepEqual(f.engine.state.tasks.map(t => t.date), ['2026-10-26', '2026-10-28', '2026-10-30']);
  assert.equal(weekday('2026-10-25'), 7);
});
test('Sunday and arbitrary weekday combinations are supported and sorted', () => {
  const f = fixture({ kind: 'weekly', weekdays: [7, 2] });
  assert.deepEqual(f.template.schedule.weekdays, [2, 7]);
  assert.equal(f.engine.state.tasks[0].date, '2026-10-25');
  assert.deepEqual(nextOccurrences(f.template, '2026-10-25', 4), ['2026-10-25', '2026-10-27', '2026-11-01', '2026-11-03']);
});
test('every three days uses the chosen anchor across months; missed dates are not backfilled', () => {
  const f = fixture({ kind: 'interval', everyDays: 3 });
  f.day('2026-10-26'); f.day('2026-10-27'); f.day('2026-10-28'); f.day('2026-11-03');
  assert.deepEqual(f.engine.state.tasks.map(t => t.date), ['2026-10-25', '2026-10-28', '2026-11-03']);
  assert.deepEqual(nextOccurrences(f.template, '2026-10-26', 4), ['2026-10-28', '2026-10-31', '2026-11-03', '2026-11-06']);
  const restored = new FocusEngine(f.engine.snapshot(), { wall: () => new Date('2026-11-03T12:00:00') });
  assert.equal(restored.state.tasks.length, 3);
  assert.equal(new Set(restored.state.tasks.flatMap(t => t.subtasks.map(s => s.id))).size, 3);
});
test('future start date suppresses premature generation and remains the interval anchor', () => {
  const f = fixture({ kind: 'interval', everyDays: 3 }, '2026-11-01');
  assert.equal(f.engine.state.tasks.length, 0); f.day('2026-10-31');
  assert.equal(f.engine.state.tasks.length, 0); f.day('2026-11-01'); f.day('2026-11-02'); f.day('2026-11-04');
  assert.deepEqual(f.engine.state.tasks.map(t => t.date), ['2026-11-01', '2026-11-04']);
});
test('calendar intervals are independent of DST and correctly cross leap day/year boundaries', () => {
  assert.equal(dayNumber('2026-03-09') - dayNumber('2026-03-08'), 1);
  assert.equal(dayNumber('2026-11-02') - dayNumber('2026-11-01'), 1);
  const t = { enabled: true, schedule: { kind: 'interval', everyDays: 2 }, startDate: '2028-02-27' };
  assert.deepEqual(nextOccurrences(t, '2028-02-27', 3), ['2028-02-27', '2028-02-29', '2028-03-02']);
  t.startDate = '2026-12-31'; assert.deepEqual(nextOccurrences(t, '2026-12-31', 3), ['2026-12-31', '2027-01-02', '2027-01-04']);
  t.startDate = '9999-12-31'; assert.deepEqual(nextOccurrences(t, t.startDate), ['9999-12-31']);
});
test('editing a rule preserves every existing snapshot, including today; disabling retains history', () => {
  const f = fixture({ kind: 'daily' }), before = structuredClone(f.engine.state.tasks);
  f.engine.dispatch({ type: 'template', id: f.template.id, fields: { ...fields, title: '每周阅读' }, schedule: { kind: 'weekly', weekdays: [3] }, startDate: '2026-10-25' });
  assert.deepEqual(f.engine.state.tasks, before); f.day('2026-10-26'); assert.equal(f.engine.state.tasks.length, 1);
  f.day('2026-10-28'); assert.equal(f.engine.state.tasks[1].title, '每周阅读');
  f.engine.dispatch({ type: 'templateEnabled', id: f.template.id, enabled: false }); f.day('2026-11-04');
  assert.equal(f.engine.state.tasks.length, 2);
  f.engine.dispatch({ type: 'templateEnabled', id: f.template.id, enabled: true });
  assert.equal(f.engine.state.tasks.length, 3);
  f.engine.dispatch({ type: 'archive', id: f.engine.state.tasks[2].id }); f.engine.ensureToday();
  assert.equal(f.engine.state.tasks.length, 3);
});
test('editing an off-day plan to due-today generates one instance immediately', () => {
  const f = fixture({ kind: 'weekly', weekdays: [1] });
  assert.equal(f.engine.state.tasks.length, 0);
  f.engine.dispatch({ type: 'template', id: f.template.id, fields, schedule: { kind: 'weekly', weekdays: [7] } });
  f.engine.ensureToday(); assert.equal(f.engine.state.tasks.length, 1);
});
test('invalid and malformed schedules cannot partially modify a plan or imported backup', () => {
  for (const s of [{ kind: 'weekly', weekdays: [] }, { kind: 'weekly', weekdays: [1, 1] }, { kind: 'weekly', weekdays: [0] }, { kind: 'weekly', weekdays: [8] }, { kind: 'interval', everyDays: 0 }, { kind: 'interval', everyDays: 1.5 }, { kind: 'interval', everyDays: 3651 }, { kind: 'interval', everyDays: '3' }, { kind: 'unknown' }]) assert.throws(() => validateSchedule(s));
  const f = fixture({ kind: 'daily' }), before = f.engine.snapshot();
  assert.throws(() => f.engine.dispatch({ type: 'template', id: f.template.id, fields: { ...fields, title: '不应保存' }, schedule: { kind: 'weekly', weekdays: [] } }));
  assert.deepEqual(f.engine.snapshot(), before);
  const broken = structuredClone(before); delete broken.templates[0].schedule;
  assert.throws(() => validateState(broken), /重复规则/);
  assert.throws(() => decodeBackup(JSON.stringify({ format: 'shiguang-focus-backup', data: broken })), /重复规则/);
});
test('v1 backup migration preserves tasks, sessions, settings, identities, and the caller input', () => {
  const f = fixture({ kind: 'daily' }), legacy = f.engine.snapshot();
  legacy.schemaVersion = 1; delete legacy.templates[0].schedule;
  const original = structuredClone(legacy);
  const migrated = decodeBackup(JSON.stringify({ format: 'shiguang-focus-backup', data: legacy }));
  assert.equal(migrated.schemaVersion, 2); assert.deepEqual(migrated.templates[0].schedule, { kind: 'daily' });
  assert.deepEqual(migrated.tasks, original.tasks); assert.deepEqual(migrated.sessions, original.sessions); assert.deepEqual(migrated.settings, original.settings);
  assert.equal(migrated.templates[0].id, original.templates[0].id); assert.deepEqual(legacy, original);
});
