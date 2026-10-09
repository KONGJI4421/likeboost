// จัดเก็บข้อมูลเป็นไฟล์ JSON — เขียนแบบต่อคิวเพื่อกันไฟล์พัง
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve('data');

export function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
  } catch {
    return fallback;
  }
}

const queues = new Map();
export function saveJSON(file, data) {
  const p = path.join(DATA_DIR, file);
  const prev = queues.get(file) || Promise.resolve();
  const next = prev
    .then(() => fs.promises.writeFile(p + '.tmp', JSON.stringify(data, null, 2), 'utf8'))
    .then(() => fs.promises.rename(p + '.tmp', p))
    .catch((e) => console.error('[store] บันทึกไฟล์ล้มเหลว:', file, e.message));
  queues.set(file, next);
  return next;
}
