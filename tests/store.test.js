import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalStore } from '../electron/store.js';
import { blankState } from '../src/core/model.js';

const tempStore = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiguang-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return new LocalStore(dir); };
test('T02/T16: atomic disk persistence and repeatable load', t => {
  const store = tempStore(t), data = blankState();
  store.save(data); assert.deepEqual(store.load(), data);
  data.settings.sound = false; store.save(data); assert.deepEqual(store.load(), data);
  assert.equal(fs.existsSync(`${store.file}.tmp`), false);
  assert.equal(JSON.parse(fs.readFileSync(`${store.file}.bak`)).settings.sound, true);
});
test('damaged primary recovers previous validated checkpoint and preserves damaged copy', t => {
  const store = tempStore(t), data = blankState(); store.save(data); store.save(data);
  fs.writeFileSync(store.file, 'corrupt'); assert.deepEqual(store.load(), data);
  assert.match(store.warning, /恢复/);
  assert.equal(fs.readdirSync(store.directory).some(f => f.includes('.damaged-')), true);
});
test('two damaged files fail closed, never silently erase user history', t => {
  const store = tempStore(t); fs.writeFileSync(store.file, 'bad'); fs.writeFileSync(`${store.file}.bak`, 'bad');
  assert.throws(() => store.load(), /保护历史记录/); assert.equal(fs.readFileSync(store.file, 'utf8'), 'bad');
});
test('invalid writes cannot alter valid persisted data; import safety copy retained', t => {
  const store = tempStore(t), data = blankState(); store.save(data);
  assert.throws(() => store.save({ ...data, schemaVersion: 999 })); assert.deepEqual(store.load(), data);
  store.safetyBackup(); assert.equal(fs.readdirSync(store.directory).filter(f => f.startsWith('before-import-')).length, 1);
});
test('v1 upgrade keeps an exact original backup, writes v2 checkpoints, and is idempotent', t => {
  const store = tempStore(t), legacy = { ...blankState(), schemaVersion: 1 };
  const raw = JSON.stringify(legacy, null, 2); fs.writeFileSync(store.file, raw);
  const migrated = store.load(); assert.equal(migrated.schemaVersion, 2);
  const backups = fs.readdirSync(store.directory).filter(f => f.startsWith('before-v2-'));
  assert.equal(backups.length, 1); assert.equal(fs.readFileSync(path.join(store.directory, backups[0]), 'utf8'), raw);
  assert.equal(JSON.parse(fs.readFileSync(store.file)).schemaVersion, 2);
  assert.equal(JSON.parse(fs.readFileSync(`${store.file}.bak`)).schemaVersion, 2);
  store.load(); store.save(migrated); store.load();
  assert.equal(fs.readdirSync(store.directory).filter(f => f.startsWith('before-v2-')).length, 1);
});
test('a failed upgrade backup prevents migration and leaves the original bytes unchanged', t => {
  const store = tempStore(t), raw = JSON.stringify({ ...blankState(), schemaVersion: 1 });
  fs.writeFileSync(store.file, raw);
  const copy = fs.copyFileSync;
  t.mock.method(fs, 'copyFileSync', (from, to, ...args) => { if (String(to).includes('before-v2-')) throw new Error('simulated disk full'); return copy(from, to, ...args); });
  assert.throws(() => store.load(), /disk full/);
  assert.equal(fs.readFileSync(store.file, 'utf8'), raw);
});
test('an unknown future schema never falls back to and overwrites with an old checkpoint', t => {
  const store = tempStore(t), raw = JSON.stringify({ ...blankState(), schemaVersion: 3 });
  fs.writeFileSync(store.file, raw); fs.writeFileSync(`${store.file}.bak`, JSON.stringify({ ...blankState(), schemaVersion: 1 }));
  assert.throws(() => store.load(), /版本/); assert.equal(fs.readFileSync(store.file, 'utf8'), raw);
});
