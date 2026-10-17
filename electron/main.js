import { app, BrowserWindow, ipcMain, dialog, powerMonitor, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FocusEngine } from '../src/core/engine.js';
import { decodeBackup, localDate, validateState } from '../src/core/model.js';
import { LocalStore } from './store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Test data overrides are deliberately unavailable in a packaged app.
const dataDirectory = !app.isPackaged && process.env.FOCUS_TEST_DATA
  ? path.resolve(process.env.FOCUS_TEST_DATA)
  : path.join(app.getPath('appData'), 'ShiguangFocus');
let startupError = '';
try { fs.mkdirSync(dataDirectory, { recursive: true }); app.setPath('userData', dataDirectory); }
catch (error) { startupError = `无法创建本地数据目录：${dataDirectory}\n${error.message}`; }
app.setName('拾光专注');
if (startupError) app.whenReady().then(() => { dialog.showErrorBox('无法安全启动', startupError); app.quit(); });
else if (!app.requestSingleInstanceLock()) app.quit();
else {
  let win, engine, store, storageError = '', lastSave = 0, lastDay = '', quitting = false;
  const payload = () => ({ state: engine.snapshot(), fullscreen: win?.isFullScreen() ?? false, today: localDate(), storageError, dataPath: store.directory, version: app.getVersion() });
  const broadcast = () => { if (win && !win.isDestroyed()) win.webContents.send('focus:update', payload()); };
  const save = () => {
    try {
      store.save(engine.state); lastSave = performance.now(); storageError = '';
      if (engine.alertPending) { engine.alertPending = false; if (engine.state.settings.sound) shell.beep(); }
      return true;
    } catch (error) {
      engine.pause(); storageError = `保存失败，计时已暂停。请检查磁盘空间和数据目录权限：${error.message}`;
      broadcast(); return false;
    }
  };
  const guard = handler => async (event, ...args) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('拒绝未知窗口的请求');
    try { return { ok: true, value: await handler(...args) }; }
    catch (error) { return { ok: false, error: error.message || '操作失败，请重试' }; }
  };
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(async () => {
  store = new LocalStore(path.join(app.getPath('userData'), 'data'));
  try { engine = new FocusEngine(store.load()); }
  catch (error) { dialog.showErrorBox('无法安全读取本地数据', error.message); app.quit(); }
  if (engine) {
    save();
    win = new BrowserWindow({
      width: 1320, height: 880, minWidth: 960, minHeight: 680,
      title: '拾光专注', backgroundColor: '#f7f8f5', icon: path.join(root, 'assets/icon.png'),
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(root, 'electron/preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
    });
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win.on('enter-full-screen', broadcast);
    win.on('leave-full-screen', broadcast);
    win.on('close', event => {
      if (!quitting) { engine.pause(); if (!save()) { event.preventDefault(); dialog.showErrorBox('请先保存数据', storageError); } }
    });
    ipcMain.handle('focus:get', guard(() => {
      engine.tick();
      if (engine.alertPending) save();
      return payload();
    }));
    ipcMain.handle('focus:command', guard(command => {
      if (!command || typeof command.type !== 'string') throw new Error('操作数据无效');
      if (storageError && !save()) throw new Error(storageError);
      engine.dispatch(command);
      if (!save()) throw new Error(storageError);
      broadcast(); return payload();
    }));
    ipcMain.handle('focus:fullscreen', guard(enabled => {
      if (enabled && !engine.state.active) throw new Error('请先开始一个任务');
      win.setFullScreen(Boolean(enabled));
      return payload();
    }));
    ipcMain.handle('focus:confirm', guard(async options => {
      const result = await dialog.showMessageBox(win, { type: 'question', title: '拾光专注', message: String(options.message).slice(0, 1000), detail: String(options.detail || '').slice(0, 2000), buttons: ['取消', String(options.accept || '确定').slice(0, 30)], defaultId: 0, cancelId: 0, noLink: true });
      return result.response === 1;
    }));
    ipcMain.handle('focus:directory', guard(async () => {
      const error = await shell.openPath(store.directory);
      if (error) throw new Error(error);
    }));
    ipcMain.handle('focus:export', guard(async () => {
      const { canceled, filePath } = await dialog.showSaveDialog(win, { title: '导出完整备份', defaultPath: `拾光专注备份-${localDate()}.json`, filters: [{ name: '拾光专注备份', extensions: ['json'] }] });
      if (canceled) return false;
      engine.tick();
      if (!save()) throw new Error(storageError);
      const data = { format: 'shiguang-focus-backup', exportedAt: new Date().toISOString(), data: engine.snapshot() };
      fs.writeFileSync(`${filePath}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 });
      fs.renameSync(`${filePath}.tmp`, filePath);
      return true;
    }));
    ipcMain.handle('focus:import', guard(async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: '选择完整备份', properties: ['openFile'], filters: [{ name: '拾光专注备份', extensions: ['json'] }] });
      if (canceled) return false;
      if (fs.statSync(filePaths[0]).size > 20 * 1024 * 1024) throw new Error('备份超过 20 MB，请先保留文件并联系维护者');
      const imported = decodeBackup(fs.readFileSync(filePaths[0], 'utf8'));
      const result = await dialog.showMessageBox(win, { type: 'warning', message: '用备份替换当前全部数据？', detail: '包含任务、历史、每日模板、设置和计时记录。当前数据会额外保留一份导入前备份。恢复的计时将处于暂停状态。', buttons: ['取消', '备份并替换'], defaultId: 0, cancelId: 0, noLink: true });
      if (result.response !== 1) return false;
      engine.pause();
      if (!save()) throw new Error(storageError);
      store.safetyBackup();
      const replacement = new FocusEngine(validateState(imported));
      // Persist first; a failed write leaves the original in-memory state untouched.
      store.save(replacement.state);
      engine = replacement; lastSave = performance.now();
      if (win.isFullScreen()) win.setFullScreen(false);
      broadcast(); return true;
    }));
    const timer = setInterval(() => {
      engine.tick();
      const today = localDate();
      let changed = false;
      const dateChanged = today !== lastDay;
      if (dateChanged) { lastDay = today; changed = engine.ensureToday(); }
      if (changed || engine.alertPending || (engine.state.active && performance.now() - lastSave >= 1500)) save();
      if (dateChanged || changed || engine.state.active) broadcast();
    }, 250);
    powerMonitor.on('suspend', () => { engine.pause(); save(); broadcast(); });
    powerMonitor.on('resume', () => { engine.ensureToday(); save(); broadcast(); });
    powerMonitor.on('shutdown', () => { engine.pause(); save(); });
    app.on('before-quit', event => {
      engine.pause();
      if (!save()) { event.preventDefault(); quitting = false; dialog.showErrorBox('请先保存数据', storageError); return; }
      quitting = true; clearInterval(timer);
    });
    app.on('window-all-closed', () => app.quit());
    if (!app.isPackaged && process.env.FOCUS_DEV_URL === 'http://127.0.0.1:5173') await win.loadURL(process.env.FOCUS_DEV_URL);
    else await win.loadFile(path.join(root, 'dist/index.html'));
    if (store.warning) await dialog.showMessageBox(win, { type: 'warning', message: store.warning });
  }
  }).catch(error => { dialog.showErrorBox('启动失败', error.message); app.quit(); });
}
