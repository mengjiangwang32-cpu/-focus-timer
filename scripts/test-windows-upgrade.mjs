import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { _electron as electron } from '@playwright/test';

// Real installers use the user's registry/profile. Never run this against a
// developer's or end user's existing installation: a fresh hosted CI VM only.
if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true') throw new Error('覆盖安装验证仅允许在一次性 GitHub Windows runner 上执行');
const run = promisify(execFile);
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'shiguang-upgrade-'));
const installDir = path.join(stage, 'installed');
assert.ok(!/\s/.test(installDir), 'NSIS /D test path must not contain spaces');
const profile = path.join(process.env.APPDATA, 'ShiguangFocus');
assert.ok(!fs.existsSync(profile), 'Refusing to touch a pre-existing application profile');
const oldInstaller = path.join(stage, 'v1-setup.exe');
const installer = path.resolve(`release/Shiguang-Focus-${version}-Windows-x64.exe`);
const executable = path.join(installDir, '拾光专注.exe');
const dataFile = path.join(profile, 'data', 'focus-data.json');
const report = { version, commit: process.env.GITHUB_SHA, checks: [] };
const checked = text => { report.checks.push(text); console.log('PASS:', text); };
const response = await fetch('https://github.com/mengjiangwang32-cpu/-focus-timer/releases/download/shiguang-v1.0.0/Shiguang-Focus-1.0.0-Windows-x64.exe', { signal: AbortSignal.timeout(120000) });
assert.ok(response.ok, `Could not download v1 installer: ${response.status}`);
await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(oldInstaller));
const oldHash = await crypto.hash('sha256', fs.readFileSync(oldInstaller));
assert.equal(oldHash, '315e84ef38b210d37beebab2c8c982f7ceef8367c7ca7d73706da9cb552d27c8');
checked('官方 1.0.0 安装包 SHA256 校验通过');

let app;
async function open() {
  app = await electron.launch({ executablePath: executable, timeout: 30000 });
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.focusApp), null, { timeout: 15000 });
  return page;
}
async function view(page) {
  const result = await page.evaluate(() => window.focusApp.getState());
  assert.equal(result.ok, true, result.error); return result.value;
}
async function command(page, value) {
  const result = await page.evaluate(command => window.focusApp.command(command), value);
  assert.equal(result.ok, true, result.error); return result.value.state;
}
async function install(file) {
  await run(file, ['/S', `/D=${installDir}`], { timeout: 120000, windowsHide: true });
  assert.ok(fs.existsSync(executable), 'Installer did not create the application at the requested directory');
}
try {
  await install(oldInstaller);
  let page = await open();
  let initial = await view(page); assert.equal(initial.version, '1.0.0');
  const fields = { title: '升级前的每日阅读', budgetMs: 1500000, priority: 'high', notes: '这段历史和备注必须在覆盖安装后保留。', subtasks: [{ id: 'legacy-upgrade-child', title: '读一个章节', done: false }] };
  await command(page, { type: 'create', date: initial.today, fields, repeat: true });
  let state = await command(page, { type: 'create', date: initial.today, fields: { ...fields, title: '升级前尚未结束的任务', subtasks: [] } });
  const task = state.tasks.at(-1);
  await command(page, { type: 'start', id: task.id });
  await page.waitForTimeout(700);
  await command(page, { type: 'pause' });
  await command(page, { type: 'settings', sound: false, fullscreenHintSeen: true });
  const before = (await view(page)).state;
  assert.equal(before.schemaVersion, 1); assert.ok(before.sessions[0].elapsedMs > 0);
  await app.close(); app = null;
  checked('真实安装并运行 1.0.0，写入任务、每日模板、备注、子任务、设置及计时记录');

  await install(installer);
  page = await open();
  const upgraded = await view(page); assert.equal(upgraded.version, version);
  const after = upgraded.state;
  assert.equal(after.schemaVersion, 2);
  assert.deepEqual(after.tasks, before.tasks);
  assert.deepEqual(after.sessions, before.sessions);
  assert.deepEqual(after.active, { ...before.active, paused: true });
  assert.deepEqual(after.settings, before.settings);
  assert.deepEqual(after.templates, before.templates.map(t => ({ ...t, schedule: { kind: 'daily' } })));
  const backups = fs.readdirSync(path.dirname(dataFile)).filter(f => f.startsWith('before-v2-'));
  assert.equal(backups.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(path.dirname(dataFile), backups[0]), 'utf8')), before);
  checked('直接覆盖安装新版，旧任务、用时、历史关联、模板、设置全部保留且不重复生成');
  checked('升级前原始 v1 数据自动备份，重开后计时保持暂停');
  const desktop = (await run('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"])).stdout.trim();
  assert.ok(fs.existsSync(path.join(desktop, '拾光专注.lnk')));
  checked('桌面快捷方式仍存在');
  await app.close(); app = null;
  page = await open();
  assert.deepEqual((await view(page)).state, after);
  await app.close(); app = null;
  checked('覆盖升级后再次启动，数据和任务数量不变');
  const uninstaller = fs.readdirSync(installDir).find(f => /^Uninstall.*\.exe$/i.test(f));
  assert.ok(uninstaller);
  await run(path.join(installDir, uninstaller), ['/S'], { timeout: 120000, windowsHide: true });
  assert.ok(fs.existsSync(dataFile));
  assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).schemaVersion, 2);
  checked('正常卸载仍保留用户数据');
  fs.writeFileSync('release/upgrade-verification.json', JSON.stringify(report, null, 2));
} finally {
  if (app) await app.close().catch(() => {});
}
