// ระบบแจ้งเตือนแบบ push หาแอดมิน (Web Push มาตรฐาน — ใช้ได้ทั้ง iPhone แอปหน้าจอโฮม และ Android)
// VAPID keys สร้างครั้งแรกแล้วเก็บที่ data/vapid.json (ห้ามลบ ถ้าลบทุกเครื่องต้องกดเปิดแจ้งเตือนใหม่)
import webpush from 'web-push';
import fs from 'node:fs';
import path from 'node:path';

const DATA = path.resolve('data');
let keys = null;

function loadKeys() {
  if (keys) return keys;
  try {
    keys = JSON.parse(fs.readFileSync(path.join(DATA, 'vapid.json'), 'utf8'));
  } catch {
    keys = webpush.generateVAPIDKeys();
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(path.join(DATA, 'vapid.json'), JSON.stringify(keys, null, 2));
  }
  webpush.setVapidDetails('mailto:admin@likeboost.kongkt.online', keys.publicKey, keys.privateKey);
  return keys;
}

function loadSubs() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, 'push-subs.json'), 'utf8'));
  } catch {
    return [];
  }
}
function saveSubs(list) {
  fs.writeFileSync(path.join(DATA, 'push-subs.json'), JSON.stringify(list, null, 2));
}

export function getPublicKey() {
  return loadKeys().publicKey;
}

// จดจำอุปกรณ์ที่ขอรับแจ้งเตือน (เครื่องละ 1 รายการ ตัดซ้ำด้วย endpoint)
export function addSub(sub) {
  if (!sub || !sub.endpoint) return;
  const list = loadSubs();
  if (!list.some((s) => s.endpoint === sub.endpoint)) {
    list.push(sub);
    saveSubs(list);
  }
}

// ยิงแจ้งเตือนหาทุกอุปกรณ์แอดมิน — ลบ subscription ที่หมดอายุทิ้งเอง
export async function notifyAdmins(payload) {
  loadKeys();
  const list = loadSubs();
  if (!list.length) return { sent: 0, total: 0 };
  const dead = [];
  const results = await Promise.allSettled(
    list.map((s) =>
      webpush.sendNotification(s, JSON.stringify(payload)).catch((err) => {
        if (err.statusCode === 404 || err.statusCode === 410) dead.push(s.endpoint);
        throw err;
      })
    )
  );
  if (dead.length) {
    saveSubs(loadSubs().filter((s) => !dead.includes(s.endpoint)));
  }
  const sent = results.filter((r) => r.status === 'fulfilled').length;
  return { sent, total: list.length };
}
