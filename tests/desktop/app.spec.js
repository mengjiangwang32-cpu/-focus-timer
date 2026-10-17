import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let desktop, page, directory, temporaryRoot;
async function launch() {
  desktop = await electron.launch({
    args: [...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []), '.'],
    env: { ...process.env, FOCUS_TEST_DATA: directory, XDG_CACHE_HOME: path.join(directory, 'cache') }
  });
  page = await desktop.firstWindow();
  await expect(page.getByRole('heading', { name: '今天，也专注一点。' })).toBeVisible();
}
const state = async () => page.evaluate(async () => (await window.focusApp.getState()).value.state);
const command = async command => page.evaluate(async value => {
  const result = await window.focusApp.command(value);
  if (!result.ok) throw new Error(result.error);
  return result.value.state;
}, command);
const add = async (title, budgetMs = 60000) => {
  const date = await page.evaluate(async () => (await window.focusApp.getState()).value.today);
  const s = await command({ type: 'create', date, fields: { title, budgetMs, priority: 'medium', notes: '', subtasks: [] } });
  return s.tasks.at(-1);
};
const consentDialogs = async () => desktop.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
test.beforeEach(async () => { temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shiguang-desktop-')); directory = path.join(temporaryRoot, 'new-profile'); await launch(); });
test.afterEach(async () => { if (desktop) await desktop.close().catch(() => {}); fs.rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });

test('T01/T02/T12/T13: desktop form, persistence, drag ordering and daily template', async () => {
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByLabel('任务名称').fill('阅读一本书');
  await page.getByLabel('预计时长').fill('40');
  await page.getByLabel('优先级').selectOption('high');
  await page.getByLabel('备注').fill('先读第一个章节\n记录三条想法');
  await page.getByRole('button', { name: '添加子任务', exact: true }).click();
  await page.getByRole('textbox', { name: '子任务1', exact: true }).fill('阅读第一章');
  await page.getByRole('button', { name: '添加子任务', exact: true }).click();
  await page.getByRole('textbox', { name: '子任务2', exact: true }).fill('写下三条笔记');
  await page.getByRole('button', { name: '上移子任务2', exact: true }).click();
  await page.getByLabel('每天重复').check();
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(page.getByText('阅读一本书', { exact: true })).toBeVisible();
  const first = (await state()).tasks[0];
  expect(first.budgetMs).toBe(2400000); expect(first.priority).toBe('high');
  await add('整理笔记');
  await page.getByRole('button', { name: '调整整理笔记顺序', exact: true }).dragTo(page.getByRole('button', { name: '调整阅读一本书顺序', exact: true }));
  await expect.poll(async () => (await state()).tasks[0].title).toBe('整理笔记');
  await desktop.close(); await launch();
  const recovered = await state(); expect(recovered.tasks).toHaveLength(2); expect(recovered.tasks[0].title).toBe('整理笔记');
  expect(recovered.tasks[1].notes).toContain('三条想法'); expect(recovered.tasks[1].subtasks.map(s => s.title)).toEqual(['写下三条笔记', '阅读第一章']);
  expect(recovered.templates).toHaveLength(1);
  await page.getByRole('button', { name: '每日重复', exact: true }).click();
  await expect(page.getByRole('heading', { name: '阅读一本书', exact: true })).toBeVisible();
});

test('T03–T10/T18/T21: real fullscreen, Esc, space, minimize, overtime and two sessions', async () => {
  const task = await add('短时间专注', 5000);
  await page.getByRole('button', { name: '开始短时间专注', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '一段安静的专注时间' })).toBeVisible();
  await page.getByRole('button', { name: '开始专注', exact: true }).click();
  await expect(page.getByTestId('fullscreen')).toBeVisible();
  expect(await page.getByTestId('fullscreen').locator('*').count()).toBe(1);
  await page.keyboard.press('Space');
  const paused = (await state()).sessions[0].elapsedMs;
  await page.waitForTimeout(800);
  expect((await state()).sessions[0].elapsedMs).toBe(paused);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fullscreen')).toHaveCount(0);
  await expect(page.getByText('计时已暂停', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续计时', exact: true }).click();
  await expect.poll(async () => (await state()).active.paused).toBe(false);
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await page.waitForTimeout(1000);
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
  expect((await state()).sessions[0].elapsedMs).toBeGreaterThan(paused + 800);
  await page.getByRole('button', { name: '返回全屏', exact: true }).last().click();
  await expect(page.getByTestId('fullscreen')).toContainText('+', { timeout: 10000 });
  await page.keyboard.press('Escape');
  expect((await state()).tasks[0].completed).toBe(false);
  await page.getByRole('button', { name: '结束本次', exact: true }).click();
  const ended = (await state()).sessions[0].elapsedMs;
  await page.getByRole('button', { name: '开始短时间专注', exact: true }).click();
  await expect(page.getByTestId('fullscreen')).toContainText('+');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '完成任务', exact: true }).click();
  expect((await state()).active).toBeNull(); expect((await state()).tasks[0].completed).toBe(true);
  await page.getByRole('button', { name: '取消完成短时间专注', exact: true }).click();
  const s = await state(); expect(s.tasks[0].completed).toBe(false); expect(s.tasks[0].alerted).toBe(true);
  expect(s.sessions.reduce((n, x) => n + x.elapsedMs, 0)).toBeGreaterThanOrEqual(ended);
  expect(s.sessions).toHaveLength(2);
});

test('T11/T15: switch confirmation, unfinished children and history detail', async () => {
  await consentDialogs();
  const a = await add('任务甲'), b = await add('任务乙');
  await command({ type: 'edit', id: b.id, fields: { ...b, subtasks: [{ id: 'unfinished-child', title: '尚未完成的小步骤', done: false }] } });
  await command({ type: 'settings', fullscreenHintSeen: true });
  await page.getByRole('button', { name: '开始任务甲', exact: true }).click();
  await expect(page.getByTestId('fullscreen')).toBeVisible(); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '开始任务乙', exact: true }).click();
  await expect(page.getByTestId('fullscreen')).toBeVisible(); await page.keyboard.press('Escape');
  const s = await state(); expect(s.active.taskId).toBe(b.id); expect(s.sessions[0].taskId).toBe(a.id); expect(s.sessions[0].endedAt).not.toBeNull();
  await page.getByRole('button', { name: '完成任务', exact: true }).click();
  expect((await state()).tasks.find(t => t.id === b.id).subtasks[0].done).toBe(false);
  await page.getByRole('button', { name: '历史与统计', exact: true }).click();
  await expect(page.getByRole('table')).toContainText('按时完成');
  await page.getByRole('button', { name: '详情', exact: true }).last().click();
  await expect(page.getByRole('dialog', { name: '任务乙' })).toContainText('计时片段');
});

test('T16/T17: close/reopen, crash recovery and simulated power suspend', async () => {
  const task = await add('恢复专注'); await command({ type: 'start', id: task.id });
  await page.waitForTimeout(700); await desktop.close(); await launch();
  let s = await state(); expect(s.active.paused).toBe(true);
  const saved = s.sessions[0].elapsedMs; expect(saved).toBeGreaterThan(500);
  await page.waitForTimeout(500); expect((await state()).sessions[0].elapsedMs).toBe(saved);
  await command({ type: 'resume' }); await page.waitForTimeout(2500);
  const crashed = new Promise(resolve => desktop.process().once('exit', resolve));
  desktop.process().kill('SIGKILL'); await crashed; await launch();
  s = await state(); expect(s.active.paused).toBe(true); expect(s.sessions[0].elapsedMs).toBeGreaterThan(saved);
  await command({ type: 'resume' });
  await desktop.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend'));
  const atSleep = (await state()).sessions[0].elapsedMs;
  await page.waitForTimeout(600); await desktop.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'));
  s = await state(); expect(s.active.paused).toBe(true); expect(s.sessions[0].elapsedMs).toBe(atSleep);
});

test('T19/T20: actual IPC export/import, invalid-file protection and offline workflow', async () => {
  await consentDialogs(); await page.context().setOffline(true);
  const task = await add('离线任务'); await command({ type: 'start', id: task.id }); await page.waitForTimeout(350);
  await command({ type: 'settings', sound: false });
  const backup = path.join(directory, 'backup.json');
  await desktop.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, backup);
  await page.getByRole('button', { name: '设置与备份', exact: true }).click();
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  await expect.poll(() => fs.existsSync(backup)).toBe(true);
  const exported = JSON.parse(fs.readFileSync(backup, 'utf8')); expect(exported.data.tasks[0].id).toBe(task.id);
  await add('临时新增');
  await page.getByRole('button', { name: '导入备份', exact: true }).click();
  await expect.poll(async () => (await state()).tasks.length).toBe(1);
  expect((await state()).active.paused).toBe(true); expect((await state()).settings.sound).toBe(false);
  const before = await state(); fs.writeFileSync(backup, '{"not":"a backup"}');
  await page.getByRole('button', { name: '导入备份', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('请选择拾光专注导出的备份文件');
  expect(await state()).toEqual(before);
  expect(fs.readdirSync(path.join(directory, 'data')).some(f => f.startsWith('before-import-'))).toBe(true);
});

test('T14: editing and stopping a template leaves today snapshot untouched', async () => {
  await page.getByRole('button', { name: '每日重复', exact: true }).click();
  await page.getByRole('button', { name: '新建每日任务', exact: true }).click();
  await page.getByLabel('任务名称').fill('每日阅读'); await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await page.getByRole('button', { name: '编辑模板', exact: true }).click();
  await page.getByLabel('任务名称').fill('每日写作'); await page.getByLabel('预计时长').fill('45');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.getByRole('checkbox', { name: '停用每日写作', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '启用每日写作', exact: true })).not.toBeChecked();
  const s = await state(); expect(s.templates[0].title).toBe('每日写作'); expect(s.templates[0].enabled).toBe(false);
  expect(s.tasks[0].title).toBe('每日阅读'); expect(s.tasks[0].budgetMs).toBe(1500000);
});

test('T06/T07: one sound call survives pause and reopening, and settings mute is respected', async () => {
  await desktop.evaluate(({ shell }) => { globalThis.beepCount = 0; shell.beep = () => { globalThis.beepCount++; }; });
  const task = await add('一次提醒', 1000); await command({ type: 'start', id: task.id });
  await expect.poll(() => desktop.evaluate(() => globalThis.beepCount)).toBe(1);
  await command({ type: 'pause' }); await command({ type: 'resume' }); await page.waitForTimeout(350);
  expect(await desktop.evaluate(() => globalThis.beepCount)).toBe(1);
  await desktop.close(); await launch();
  await desktop.evaluate(({ shell }) => { globalThis.beepCount = 0; shell.beep = () => { globalThis.beepCount++; }; });
  await command({ type: 'resume' }); await page.waitForTimeout(350);
  expect(await desktop.evaluate(() => globalThis.beepCount)).toBe(0);
  const muted = await add('静音提醒', 1000); await command({ type: 'settings', sound: false });
  await command({ type: 'start', id: muted.id, confirmSwitch: true });
  await expect.poll(async () => (await state()).tasks.find(t => t.id === muted.id).alerted).toBe(true);
  expect(await desktop.evaluate(() => globalThis.beepCount)).toBe(0);
});

test('midnight UI follows today, and text fields accept the space key', async () => {
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  const input = page.getByLabel('任务名称'); await input.fill('阅读'); await input.press('Space'); await input.pressSequentially('A');
  await expect(input).toHaveValue('阅读 A'); await page.getByRole('button', { name: '创建任务', exact: true }).click();
  const tomorrow = await page.evaluate(async () => {
    const value = (await window.focusApp.getState()).value;
    const date = new Date(`${value.today}T12:00:00`); date.setDate(date.getDate() + 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
  const payload = await page.evaluate(async () => (await window.focusApp.getState()).value);
  await desktop.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('focus:update', value), { ...payload, today: tomorrow });
  await expect(page.getByLabel('选择任务日期')).toHaveValue(tomorrow);
});

test('capture Chinese desktop layout and check renderer has no runtime errors', async () => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await add('阅读《深度工作》', 2700000); await add('完成今天的学习计划', 5400000); await add('整理本周的笔记', 1800000); const walk = await add('出门散步，放松一下', 1200000);
  await command({ type: 'complete', id: walk.id, completed: true });
  fs.mkdirSync('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/每日任务.png' });
  for (const name of ['历史与统计', '每日重复', '设置与备份', '每日任务']) await page.getByRole('button', { name, exact: true }).click();
  expect(errors).toEqual([]);
});
