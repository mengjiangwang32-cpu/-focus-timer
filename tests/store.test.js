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
