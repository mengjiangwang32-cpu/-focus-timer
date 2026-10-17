import fs from 'node:fs';
import path from 'node:path';
import { blankState, validateState } from '../src/core/model.js';

export class LocalStore {
  constructor(directory) { this.directory = directory; this.file = path.join(directory, 'focus-data.json'); this.warning = ''; }
  load() {
    fs.mkdirSync(this.directory, { recursive: true });
    if (!fs.existsSync(this.file) && !fs.existsSync(`${this.file}.bak`)) return blankState();
    for (const file of [this.file, `${this.file}.bak`]) {
      try {
        const state = validateState(JSON.parse(fs.readFileSync(file, 'utf8')));
        if (file.endsWith('.bak')) {
          if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.damaged-${Date.now()}`);
          fs.copyFileSync(file, this.file);
          this.warning = '数据文件损坏，已恢复上一次有效的自动备份。损坏文件已保留，请及时导出备份。';
        }
        return state;
      } catch { /* Try the previous validated checkpoint, never silently reset. */ }
    }
    throw new Error(`数据文件及自动备份无法读取。为保护历史记录，未创建新数据。请从手动备份恢复，或将此目录复制保存后再处理：${this.directory}`);
  }
  save(state) {
    validateState(state);
    const temporary = `${this.file}.tmp`;
    const fd = fs.openSync(temporary, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(state), 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
    fs.renameSync(temporary, this.file);
  }
  safetyBackup() {
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, path.join(this.directory, `before-import-${Date.now()}.json`));
  }
}
