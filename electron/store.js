import fs from 'node:fs';
import path from 'node:path';
import { blankState, validateState } from '../src/core/model.js';
import { randomUUID } from 'node:crypto';

export class LocalStore {
  constructor(directory) { this.directory = directory; this.file = path.join(directory, 'focus-data.json'); this.warning = ''; }
  load() {
    fs.mkdirSync(this.directory, { recursive: true });
    if (!fs.existsSync(this.file) && !fs.existsSync(`${this.file}.bak`)) return blankState();
    for (const file of [this.file, `${this.file}.bak`]) {
      let original, state;
      try {
        original = JSON.parse(fs.readFileSync(file, 'utf8'));
        state = validateState(original);
      } catch (error) {
        // Never replace an unknown newer format with an older checkpoint.
        if (error.code === 'UNSUPPORTED_SCHEMA') throw error;
        continue;
      }
      // I/O errors must propagate; they are not evidence of corrupt data.
      if (file.endsWith('.bak')) {
        if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.damaged-${Date.now()}`);
        fs.copyFileSync(file, this.file);
        this.warning = '数据文件损坏，已恢复上一次有效的自动备份。损坏文件已保留，请及时导出备份。';
      }
      if (original.schemaVersion === 1) {
        const backup = path.join(this.directory, `before-v2-${Date.now()}-${randomUUID()}.json`);
        fs.copyFileSync(this.file, backup, fs.constants.COPYFILE_EXCL);
        this.save(state);
        // Keep both active checkpoints in the new format. The original v1
        // remains in the dedicated upgrade backup, not the rolling .bak file.
        fs.copyFileSync(this.file, `${this.file}.bak`);
      }
      return state;
    }
    throw new Error(`数据文件及自动备份无法读取。为保护历史记录，未创建新数据。请从手动备份恢复，或将此目录复制保存后再处理：${this.directory}`);
  }
  save(state) {
    state = validateState(state);
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
