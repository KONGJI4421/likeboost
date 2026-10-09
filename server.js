// ============================================================
//  LikeBoost — เว็บปั้มโซเชียล (SMM Reseller Panel)
//  • API Key ของ partner ถูกเก็บไว้ฝั่งเซิร์ฟเวอร์เท่านั้น (.env)
//  • ลูกค้าเห็นเฉพาะราคาที่บวกกำไรแล้ว และเลขออเดอร์ของร้านเรา
//  • หน้าแอดมิน /admin (รหัสผ่านอยู่ใน .env)
// ============================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureDataDir, loadJSON, saveJSON } from './lib/store.js';
import './lib/smm.js'; // โหลด .env ก่อนใช้งาน
import { getBalance, addOrder, orderStatusBatch, scanAllServices, errorMeansUnavailable, PROVIDER_NAME } from './lib/smm.js';
import { sellRate, orderPrice, estCost } from './lib/pricing.js';
import { promptPayPayload } from './lib/promptpay.js';
import { getPublicKey, addSub, notifyAdmins } from './lib/push.js';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.resolve('public');
const DATA = path.resolve('data');
const SESSION_TTL = 30 * 24 * 3600 * 1000; // ลูกค้า 30 วัน
const ADMIN_TTL = 7 * 24 * 3600 * 1000; // แอดมิน 7 วัน

ensureDataDir();

// ---------------- ข้อมูลทั้งหมด (persist เป็น JSON) ----------------
const DEFAULT_SETTINGS = {
  siteName: 'LikeBoost',
  tagline: 'ปั้มไลค์ ปั้มฟอล ทุกโซเชียล ราคาถูกที่สุด ส่งเร็ว บริการจริง',
  markupPercent: 30, // กำไร % ที่บวกเพิ่มจากต้นทุนทุกรายการ
  minPer1000: 0.5, // กำไรขั้นต่ำ (บาท) ต่อการขาย 1,000 หน่วย
  minOrderPrice: 5, // ยอดขั้นต่ำต่อออเดอร์ (บาท)
  promptPayId: '', // เบอร์พร้อมเพย์ / เลขบัตรประชาชน สำหรับรับเงิน
  lineContact: '', // ไลน์ติดต่อ
  topupMin: 10, // ยอดเติมขั้นต่ำ (บาท)
  topupMax: 100000, // ยอดเติมสูงสุด (บาท)
  topupAmounts: '50,100,200,500,1000', // ยอดลัดให้ลูกค้ากดเลือก (แก้ได้จากหน้าแอดมิน)
};

let users = loadJSON('users.json', {}); // { username: {...} }
let orders = loadJSON('orders.json', []);
let topups = loadJSON('topups.json', []);
let messages = loadJSON('messages.json', []); // เคสติดต่อแอดมิน (ticket) — แต่ละเคสมีบทสนทนาซ้อนอยู่ข้างใน
let announces = loadJSON('announces.json', []); // ประกาศ/อัปเดตจากแอดมิน → โชว์หน้าคำสั่งซื้อของลูกค้า
// โยกย้ายข้อความเก่าแบบแบน (ถ้ามี) ให้กลายเป็นเคส
{
  let migrated = false;
  messages = messages.map((m) => {
    if (Array.isArray(m.messages)) return m;
    migrated = true;
    return {
      id: m.id || 'T' + Date.now().toString(36),
      userId: m.userId ?? null, username: m.username ?? null, name: m.name ?? null,
      contact: m.contact ?? null,
      messages: [{ from: 'customer', text: m.message || '', at: m.createdAt || Date.now() }],
      status: 'closed', readByAdmin: true, readByCustomer: true,
      createdAt: m.createdAt || Date.now(), updatedAt: m.createdAt || Date.now(),
    };
  });
  if (migrated) saveJSON('messages.json', messages);
}
let meta = loadJSON('meta.json', { orderSeq: 0, topupSeq: 0 });
let settings = { ...DEFAULT_SETTINGS, ...loadJSON('settings.json', {}) };
// เติมรหัสสมาชิกให้บัญชีเก่าที่ยังไม่มี (เรียงตามวันสมัคร)
{
  const missing = Object.values(users).filter((u) => !u.uid).sort((a, b) => a.createdAt - b.createdAt);
  if (missing.length) {
    let n = meta.memberSeq || 0;
    for (const u of missing) {
      n += 1;
      u.uid = 'U' + String(n).padStart(3, '0');
    }
    meta.memberSeq = n;
    saveJSON('users.json', users);
    saveJSON('meta.json', meta);
  }
}
let sessions = loadJSON('sessions.json', {});
// แคช catalog แยกไฟล์ตามผู้ให้บริการ — กันเอาของเบอร์เก่ามาโชว์ตอนสลับ
const SERVICES_CACHE = 'services-raw-' + PROVIDER_NAME + '.json';
let servicesRaw = loadJSON(SERVICES_CACHE, []);
// บริการที่ต้นทางปิดอยู่ → ซ่อนจากหน้าร้านชั่วคราว (คืนเมื่อหมดเวลา แล้วให้ลองสั่งใหม่เป็นการทดสอบ)
let serviceBlocks = loadJSON('service-blocks.json', {});
const BLOCK_MS = 60 * 60 * 1000; // ล็อก 1 ชม. — สั้นพอที่จะกลับมาขายไวเมื่อต้นทางฟื้น (ลูกค้าที่ชนช่วงปิดได้เงินคืนอัตโนมัติอยู่แล้ว)
const blockedIds = () => Object.entries(serviceBlocks).filter(([, until]) => until > Date.now()).map(([id]) => id);
const blockService = (id) => { serviceBlocks[id] = Date.now() + BLOCK_MS; saveJSON('service-blocks.json', serviceBlocks); };

const persist = {
  users: () => saveJSON('users.json', users),
  orders: () => saveJSON('orders.json', orders),
  topups: () => saveJSON('topups.json', topups),
  messages: () => saveJSON('messages.json', messages),
  announces: () => saveJSON('announces.json', announces),
  meta: () => saveJSON('meta.json', meta),
  settings: () => saveJSON('settings.json', settings),
  sessions: () => saveJSON('sessions.json', sessions),
  services: () => saveJSON(SERVICES_CACHE, servicesRaw),
};

// ล้าง session หมดอายุ ทุก 10 นาที
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const sid of Object.keys(sessions)) {
    if (sessions[sid].expires < now) {
      delete sessions[sid];
      changed = true;
    }
  }
  if (changed) persist.sessions();
}, 10 * 60 * 1000).unref();

// ---------------- Utilities ----------------
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function verifyPassword(user, password) {
  const hash = hashPassword(password, user.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(user.passHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function newSession(payload) {
  const sid = crypto.randomBytes(32).toString('hex');
  sessions[sid] = { ...payload, expires: Date.now() + SESSION_TTL };
  persist.sessions();
  return sid;
}
function destroySession(sid) {
  if (sid && sessions[sid]) {
    delete sessions[sid];
    persist.sessions();
  }
}
// ต่ออายุเซสชันแบบ sliding — ใช้งานอยู่ก็ไม่หมดอายุ (บันทึกแบบประหยัด ชั่วโมงละครั้ง)
function touchSession(sid) {
  const s = sessions[sid];
  if (!s) return;
  let changed = false;
  const newExp = Date.now() + SESSION_TTL;
  if (newExp - (s.expires || 0) > 3600_000) {
    s.expires = newExp;
    changed = true;
  }
  if (s.isAdmin && s.adminExpires) {
    const newAdminExp = Date.now() + ADMIN_TTL;
    if (newAdminExp - s.adminExpires > 3600_000) {
      s.adminExpires = newAdminExp;
      changed = true;
    }
  }
  if (changed) persist.sessions();
}

// ลายนิ้วมือระบบ: เปลี่ยนทันทีเมื่อไฟล์โค้ดถูกแก้ → หน้าเว็บจะรีเฟรชตัวเอง
const ASSET_FILES = ['server.js', 'public/index.html', 'public/admin.html', 'public/js/app.js', 'public/js/admin.js', 'public/css/style.css'];
let fpCache = { at: 0, val: '' };
function systemFingerprint() {
  if (Date.now() - fpCache.at < 2000) return fpCache.val;
  let str = '';
  for (const f of ASSET_FILES) {
    try {
      str += f + ':' + fs.statSync(path.resolve(f)).mtimeMs + ';';
    } catch {
      /* ไฟล์ไม่มีก็ข้าม */
    }
  }
  fpCache = { at: Date.now(), val: crypto.createHash('md5').update(str).digest('hex').slice(0, 12) };
  return fpCache.val;
}

function setCookie(res, name, value, maxAgeSec) {
  res.setHeader('Set-Cookie', `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`);
}
function clearCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) return reject(new Error('payload ใหญ่เกินไป'));
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

// rate limit แบบ in-memory ต่อ IP
const hits = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) return false;
  arr.push(now);
  hits.set(key, arr);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of hits) {
    const keep = arr.filter((t) => now - t < 60_000);
    if (keep.length === 0) hits.delete(k);
    else hits.set(k, keep);
  }
}, 60_000).unref();

function publicUser(u) {
  return { uid: u.uid || null, username: u.username, name: u.name || u.username, phone: u.phone || null, balance: u.balance, createdAt: u.createdAt };
}
const PHONE_RE = /^0[689]\d{8}$/;
const normalizePhone = (raw) => String(raw || '').replace(/[\s-()]/g, '');

// ---------------- แคตตาล็อกบริการ (บวกกำไรแล้ว) ----------------
function serviceById(id) {
  return servicesRaw.find((s) => String(s.service) === String(id));
}
function catalogForCustomer() {
  const hidden = new Set(blockedIds());
  return servicesRaw.map((s) => ({
    id: s.service,
    name: s.name,
    category: s.category,
    rate: sellRate(s.rate, settings),
    min: Number(s.min) || 1,
    max: Number(s.max) || 1000000,
    desc: s.desc || '',
    disabled: hidden.has(String(s.service)), // ต้นทางปิดอยู่ → โชว์สีเทา ห้ามสั่งชั่วคราว
  }));
}

// ---------------- สถานะออเดอร์ ----------------
const FINAL_STATUS = ['completed', 'partial', 'canceled', 'error', 'refunded'];
function normalizeStatus(raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (!s) return 'Pending';
  if (s.includes('refund')) return 'Refunded';
  if (s.includes('complet')) return 'Completed';
  if (s.includes('partial')) return 'Partial';
  if (s.includes('cancel')) return 'Canceled';
  if (s.includes('progress') || s.includes('process') || s.includes('running')) return 'Processing';
  if (s.includes('pending') || s.includes('wait')) return 'Pending';
  return String(raw);
}

async function refreshOrders(filter, force = false) {
  const now = Date.now();
  const targets = orders.filter(
    (o) =>
      (!filter || filter(o)) &&
      o.upstreamOrder &&
      !FINAL_STATUS.includes(String(o.status).toLowerCase()) &&
      (force || now - (o.updatedAt || 0) > 90_000)
  );
  if (!targets.length) return;
  let userChanged = false;
  // ดึงสถานะแบบชุด ชุดละไม่เกิน 50 (ฟีเจอร์ partner API)
  for (let i = 0; i < targets.length; i += 50) {
    const chunk = targets.slice(i, i + 50);
    let map = null;
    try {
      map = await orderStatusBatch(chunk.map((o) => o.upstreamOrder));
    } catch {
      continue; // รอรอบหน้า
    }
    for (const o of chunk) {
      const st = map && map[o.upstreamOrder];
      if (!st || (st.status === undefined && st.remains === undefined)) continue;
      o.statusRaw = st.status ?? o.statusRaw;
      o.status = normalizeStatus(st.status);
      if (st.remains !== undefined) o.remains = st.remains;
      if (st.start_count !== undefined) o.startCount = st.start_count;
      if (st.charge !== undefined) o.charge = st.charge;
      o.updatedAt = now;
      // upstream ยกเลิก/คืนเงิน (ลิงก์ผิด/ทำไม่ได้) → คืนเครดิตลูกค้า ครั้งเดียวต่อออเดอร์
      // กรณี Canceled: หักส่วนที่ต้นทางเรียกเก็บจริง (charge) แล้วคืนส่วนที่เหลือตามสัดส่วนราคาขาย
      if ((o.status === 'Refunded' || o.status === 'Canceled') && !o.refundedToUser) {
        const charged = Number(o.charge || 0);
        const cost = Number(o.estCost || 0);
        let back = o.price;
        if (charged > 0 && cost > 0) back = Math.max(0, Math.round(o.price * (1 - charged / cost) * 100) / 100);
        if (back > 0) {
          const u = users[o.userId];
          if (u) {
            u.balance = Math.round((u.balance + back) * 100) / 100;
            o.refundedToUser = true;
            o.refundedAmount = back;
            o.error = o.status === 'Canceled'
              ? `ผู้ให้บริการยกเลิกรายการนี้ ระบบคืนเครดิต ${back.toFixed(2)} บาทแล้ว`
              : 'ผู้ให้บริการคืนเงินรายการนี้ ระบบคืนเครดิตให้แล้ว';
            userChanged = true;
          }
        } else {
          o.refundedToUser = true; // ต้นทางหักเต็มแล้ว ไม่มีส่วนต้องคืน — ปิดไว้กันคิดซ้ำ
        }
      }
    }
  }
  persist.orders();
  if (userChanged) persist.users();
}

// ---------------- PromptPay QR ----------------
function qrPayloadFor(amount) {
  if (!settings.promptPayId) return null;
  return promptPayPayload(settings.promptPayId, amount);
}

// ============================================================
//  Router
// ============================================================
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);
    const cookies = parseCookies(req.headers.cookie);
    // คุกกี้แยกกันชัดเจน: sid = ลูกค้า, admin_sid = แอดมิน (กันเขียนทับกันจนเด้งออก)
    const session = cookies.sid ? sessions[cookies.sid] : null;
    const user = session?.userId ? users[session.userId] : null;
    const adminSession = cookies.admin_sid ? sessions[cookies.admin_sid] : null;
    const isAdmin = !!(adminSession?.isAdmin && adminSession.adminExpires > Date.now());
    if (session?.userId) touchSession(cookies.sid);
    if (isAdmin) touchSession(cookies.admin_sid);
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').toString().split(',')[0].trim();

    // ---------- ดูรูปสลิป (เจ้าของ หรือ แอดมิน เท่านั้น) — ต้องอยู่หน้า static handler ----------
    // ---------- ดูรูปสลิป (เจ้าของ หรือ แอดมิน เท่านั้น) ----------
    const slipMatch = pathname.match(/^\/slips\/([A-Za-z0-9._-]+)$/);
    if (slipMatch && req.method === 'GET') {
      const t = topups.find((x) => x.slipFile === slipMatch[1]);
      if (!t) return send(res, 404, { error: 'ไม่พบสลิป' });
      if (!isAdmin && (!user || t.userId !== user.id)) return send(res, 403, { error: 'ไม่มีสิทธิ์ดูสลิปนี้' });
      const full = path.join(DATA, 'slips', path.basename(t.slipFile));
      if (!fs.existsSync(full)) return send(res, 404, { error: 'ไม่พบไฟล์สลิป' });
      const extMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
      const ext = path.extname(full).slice(1).toLowerCase();
      res.writeHead(200, { 'Content-Type': extMap[ext] || 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' });
      return res.end(fs.readFileSync(full));
    }

    // ---------- เสิร์ฟไฟล์หน้าเว็บ ----------
    if (req.method === 'GET' && !pathname.startsWith('/api/')) {
      return serveStatic(pathname, res);
    }
    if (!pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });

    // ---------- Auth ----------
    if (pathname === '/api/ping' && req.method === 'GET') {
      return send(res, 200, { fp: systemFingerprint(), t: Date.now() });
    }

    if (pathname === '/api/auth/register' && req.method === 'POST') {
      if (!rateLimit(`reg:${ip}`, 10, 60_000)) return send(res, 429, { error: 'พยายามบ่อยเกินไป รอสักครู่' });
      const body = JSON.parse(await readBody(req));
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const name = String(body.name || '').trim().slice(0, 60);
      if (!/^[A-Za-z0-9_.]{3,30}$/.test(username))
        return send(res, 400, { error: 'ชื่อผู้ใช้ต้องเป็นอังกฤษ/ตัวเลข 3-30 ตัวอักษร' });
      if (password.length < 4) return send(res, 400, { error: 'รหัสผ่านต้องยาวอย่างน้อย 4 ตัวอักษร' });
      if (users[username.toLowerCase()]) return send(res, 409, { error: 'ชื่อผู้ใช้นี้มีคนใช้แล้ว' });
      const phone = normalizePhone(body.phone);
      if (!PHONE_RE.test(phone)) return send(res, 400, { error: 'กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง (เช่น 0812345678)' });
      // รหัสผู้แนะนำ: ใช้ได้เฉพาะมีบัญชีจริง และห้ามแนะนำตัวเอง
      const refInput = String(body.ref || '').trim().toLowerCase();
      const referrer = refInput ? Object.values(users).find((x) => (x.uid || '').toLowerCase() === refInput || x.id === refInput) : null;
      const validRef = referrer && referrer.id !== username.toLowerCase() ? referrer.id : null;
      const salt = crypto.randomBytes(16).toString('hex');
      meta.memberSeq = (meta.memberSeq || 0) + 1;
      users[username.toLowerCase()] = {
        id: username.toLowerCase(),
        uid: 'U' + String(meta.memberSeq).padStart(3, '0'),
        username,
        name: name || username,
        salt,
        passHash: hashPassword(password, salt),
        balance: 0,
        phone,
        refBy: validRef || null, // แนะนำโดยใคร (จากลิงก์ ?ref=)
        createdAt: Date.now(),
      };
      persist.users();
      persist.meta();
      const sid = newSession({ userId: username.toLowerCase() });
      setCookie(res, 'sid', sid, Math.floor(SESSION_TTL / 1000));
      return send(res, 200, { ok: true, user: publicUser(users[username.toLowerCase()]) });
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      if (!rateLimit(`login:${ip}`, 15, 60_000)) return send(res, 429, { error: 'พยายามบ่อยเกินไป รอสักครู่' });
      const body = JSON.parse(await readBody(req));
      const u = users[String(body.username || '').trim().toLowerCase()];
      if (!u || !verifyPassword(u, String(body.password || ''))) {
        return send(res, 401, { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
      }
      const sid = newSession({ userId: u.id });
      setCookie(res, 'sid', sid, Math.floor(SESSION_TTL / 1000));
      return send(res, 200, { ok: true, user: publicUser(u) });
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      destroySession(cookies.sid);
      clearCookie(res, 'sid');
      return send(res, 200, { ok: true });
    }

    if (pathname === '/api/me' && req.method === 'GET') {
      if (!user) return send(res, 200, { user: null, settings: publicSettings() });
      await refreshOrders((o) => o.userId === user.id);
      return send(res, 200, { user: publicUser(user), settings: publicSettings() });
    }

    // ---------- แคตตาล็อกบริการ ----------
    if (pathname === '/api/services' && req.method === 'GET') {
      return send(res, 200, { services: catalogForCustomer(), generatedAt: meta.servicesAt || null });
    }

    // ---------- สั่งซื้อ ----------
    if (pathname === '/api/order' && req.method === 'POST') {
      if (!user) return send(res, 401, { error: 'กรุณาเข้าสู่ระบบก่อนสั่งซื้อ' });
      if (!rateLimit(`order:${user.id}`, 20, 60_000)) return send(res, 429, { error: 'สั่งบ่อยเกินไป รอสักครู่' });
      const body = JSON.parse(await readBody(req));
      const svc = serviceById(body.service);
      if (!svc) return send(res, 400, { error: 'ไม่พบรายการบริการนี้' });
      if (blockedIds().includes(String(svc.service)))
        return send(res, 400, { error: 'บริการนี้ปิดชั่วคราวจากผู้ให้บริการ (ระบบทยอยเปิดกลับเองทุก 1 ชั่วโมง) กรุณาเลือกบริการอื่นในหมวดเดียวกัน' });
      const quantity = Number(body.quantity);
      const min = Number(svc.min) || 1;
      const max = Number(svc.max) || 1000000;
      if (!Number.isInteger(quantity) || quantity < min || quantity > max)
        return send(res, 400, { error: `จำนวนต้องอยู่ระหว่าง ${min} - ${max.toLocaleString()}` });
      const link = String(body.link || '').trim();
      if (!/^https?:\/\/.{3,}/i.test(link)) return send(res, 400, { error: 'ลิงก์ไม่ถูกต้อง ต้องขึ้นต้นด้วย http(s)://' });

      const rate = sellRate(svc.rate, settings);
      const price = orderPrice(rate, quantity, settings);
      if (user.balance < price) return send(res, 400, { error: `เครดิตไม่พอ ต้องใช้ ${price.toFixed(2)} บาท (มี ${user.balance.toFixed(2)} บาท) กรุณาเติมเงิน` });

      // หักเครดิตก่อน (จะคืนให้ถ้า upstream ปฏิเสธ)
      user.balance = Math.round((user.balance - price) * 100) / 100;

      meta.orderSeq += 1;
      const orderId = 'A' + String(meta.orderSeq).padStart(6, '0');
      const order = {
        id: orderId,
        userId: user.id,
        username: user.username,
        serviceId: svc.service,
        serviceName: svc.name,
        category: svc.category,
        link,
        quantity,
        price,
        costRate: Number(svc.rate),
        estCost: estCost(svc.rate, quantity),
        charge: null,
        upstreamOrder: null,
        status: 'Pending',
        statusRaw: '',
        remains: null,
        startCount: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      orders.push(order);

      let up = null;
      try {
        up = await addOrder({ service: svc.service, link, quantity });
      } catch {
        up = { error: 'timeout' };
      }
      if (up && (up.order !== undefined || up.id !== undefined)) {
        order.upstreamOrder = String(up.order ?? up.id ?? '');
        order.status = 'Processing';
        order.statusRaw = 'Processing';
        if (up.charge !== undefined) order.charge = Number(up.charge);
        persist.orders();
        persist.users();
        persist.meta();
        notifyAdmins({
          title: 'มีออเดอร์ใหม่ ' + order.id,
          body: `${user.username} สั่ง ${order.serviceName.slice(0, 50)} × ${quantity.toLocaleString()} (ขาย ${order.price} ฿)`,
          tag: 'order-' + order.id,
          url: '/admin',
        }).catch(() => {});
        return send(res, 200, { ok: true, order: orderForCustomer(order), user: publicUser(user) });
      }

      // upstream ปฏิเสธ → คืนเครดิต + ถ้าเป็นเพราะบริการปิด ให้ซ่อนไว้ 6 ชม. กันลูกค้าชนซ้ำ
      user.balance = Math.round((user.balance + price) * 100) / 100;
      order.status = 'Error';
      order.error = up?.message || up?.error || 'สั่งซื้อไม่สำเร็จจากผู้ให้บริการ';
      if (errorMeansUnavailable(order.error)) blockService(String(svc.service));
      persist.orders();
      persist.users();
      persist.meta();
      return send(res, 400, { error: `สั่งซื้อไม่สำเร็จ: ${order.error} (คืนเครดิต ${price.toFixed(2)} บาทแล้ว)`, order: orderForCustomer(order) });
    }

    // ---------- ประวัติคำสั่งซื้อของฉัน ----------
    if (pathname === '/api/orders' && req.method === 'GET') {
      if (!user) return send(res, 401, { error: 'กรุณาเข้าสู่ระบบ' });
      await refreshOrders((o) => o.userId === user.id);
      const mine = orders.filter((o) => o.userId === user.id).sort((a, b) => b.createdAt - a.createdAt).map(orderForCustomer);
      return send(res, 200, { orders: mine });
    }

    // ---------- ติดต่อแอดมิน: ระบบเคสแบบมีบทสนทนา (สมาชิกเท่านั้น) ----------
    if (pathname === '/api/contact' && req.method === 'POST') {
      if (!user) return send(res, 401, { error: 'กรุณาเข้าสู่ระบบหรือสมัครสมาชิกก่อนแจ้งเคส' });
      if (!rateLimit(`contact:${ip}`, 8, 10 * 60_000)) return send(res, 429, { error: 'ส่งบ่อยเกินไป รอสักครู่แล้วลองใหม่' });
      const body = JSON.parse(await readBody(req));
      const text = String(body.message || '').trim().slice(0, 2000);
      if (text.length < 3) return send(res, 400, { error: 'กรุณาพิมพ์ข้อความอย่างน้อย 3 ตัวอักษร' });
      const contact = String(body.contact || '').trim().slice(0, 120);
      const TOPICS = { order: 'คำสั่งซื้อ', payment: 'การชำระเงิน', other: 'อื่นๆ' };
      // รหัสเคสแบบเลขวิ่งสั้น ๆ (T001, T002, ...) เข้ากับสไตล์ A000033
      meta.ticketSeq = (meta.ticketSeq || 0) + 1;
      const ticket = {
        id: 'T' + String(meta.ticketSeq).padStart(3, '0'),
        userId: user?.id || null,
        username: user?.username || null,
        name: user?.name || String(body.name || '').trim().slice(0, 60) || null,
        contact: contact || null,
        topic: TOPICS[String(body.topic || '')] || null,
        issueType: String(body.issueType || '').trim().slice(0, 80) || null,
        productCode: String(body.productCode || '').trim().slice(0, 60) || null,
        orderLink: /^https?:\/\//i.test(String(body.orderLink || '').trim()) ? String(body.orderLink).trim().slice(0, 300) : null,
        issueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(body.issueDate || '')) ? body.issueDate : null,
        messages: [{ from: 'customer', text, at: Date.now() }],
        status: 'open',
        readByAdmin: false,
        readByCustomer: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      // ใส่รายละเอียดที่ลูกค้ากรอกไปพร้อมข้อความแรก — เห็นครบในห้องแชททุกฝั่ง
      const detailLines = [];
      if (ticket.topic) detailLines.push('เรื่อง: ' + ticket.topic);
      if (ticket.issueType) detailLines.push('อาการ: ' + ticket.issueType);
      if (ticket.productCode) detailLines.push('สินค้า: ' + ticket.productCode);
      if (ticket.orderLink) detailLines.push('ลิงก์: ' + ticket.orderLink);
      if (ticket.issueDate) detailLines.push('วันที่: ' + ticket.issueDate);
      if (detailLines.length) {
        ticket.messages[0].text = detailLines.join('\n') + '\n\n' + text;
      }
      messages.push(ticket);
      persist.messages();
      persist.meta();
      notifyAdmins({
        title: 'ลูกค้าเปิดเคสใหม่ ' + ticket.id + (ticket.topic ? ' (' + ticket.topic + ')' : ''),
        body: (ticket.name || ticket.username || 'บุคคลทั่วไป') + (ticket.productCode ? ' [สินค้า ' + ticket.productCode + ']' : '') + ': ' + text.slice(0, 80),
        tag: 'msg-' + ticket.id,
        url: '/admin',
      }).catch(() => {});
      return send(res, 200, { ok: true, ticketId: ticket.id });
    }

    // ลูกค้าดูเคสของตัวเอง (ต้องสมัครสมาชิก — แขกไม่มีประวัติ)
    if (pathname === '/api/contact/tickets' && req.method === 'GET') {
      if (!user) return send(res, 200, { tickets: [] });
      const mine = messages
        .filter((t) => t.userId === user.id)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((t) => ({
          id: t.id,
          status: t.status,
          topic: t.topic || null,
          productCode: t.productCode || null,
          last: t.messages[t.messages.length - 1],
          unread: !t.readByCustomer,
          updatedAt: t.updatedAt,
          count: t.messages.length,
        }));
      return send(res, 200, { tickets: mine });
    }

    // ลูกค้าเปิดอ่านบทสนทนาเต็มของเคสตัวเอง
    if (pathname === '/api/contact/thread' && req.method === 'GET') {
      if (!user) return send(res, 401, { error: 'กรุณาเข้าสู่ระบบ' });
      const t = messages.find((x) => x.id === url.searchParams.get('id') && x.userId === user.id);
      if (!t) return send(res, 404, { error: 'ไม่พบเคสนี้' });
      t.readByCustomer = true;
      persist.messages();
      return send(res, 200, { ticket: { id: t.id, status: t.status, messages: t.messages, updatedAt: t.updatedAt } });
    }

    // ลูกค้าตอบกลับในเคสของตัวเอง (เคสปิดแล้วไม่ได้)
    if (pathname === '/api/contact/reply' && req.method === 'POST') {
      if (!user) return send(res, 401, { error: 'กรุณาเข้าสู่ระบบ' });
      if (!rateLimit(`contact:${ip}`, 15, 10 * 60_000)) return send(res, 429, { error: 'ส่งบ่อยเกินไป รอสักครู่' });
      const body = JSON.parse(await readBody(req));
      const t = messages.find((x) => x.id === String(body.ticketId || '') && x.userId === user.id);
      if (!t) return send(res, 404, { error: 'ไม่พบเคสนี้' });
      if (t.status === 'closed') return send(res, 400, { error: 'เคสนี้ปิดแล้ว กดเปิดเคสใหม่ได้' });
      const text = String(body.text || '').trim().slice(0, 2000);
      if (text.length < 1) return send(res, 400, { error: 'พิมพ์ข้อความก่อนส่ง' });
      t.messages.push({ from: 'customer', text, at: Date.now() });
      t.updatedAt = Date.now();
      t.readByAdmin = false;
      persist.messages();
      notifyAdmins({
        title: 'ลูกค้าตอบกลับเคส ' + t.id,
        body: (t.name || t.username || 'ลูกค้า') + ': ' + text.slice(0, 90),
        tag: 'msg-' + t.id,
        url: '/admin',
      }).catch(() => {});
      return send(res, 200, { ok: true });
    }

    // ---------- ระบบแนะนำเพื่อน ----------
    if (pathname === '/api/referral' && req.method === 'GET') {
      if (!user) return send(res, 401, { error: 'กรุณาเข้าสู่ระบบ' });
      const invited = Object.values(users).filter((x) => x.refBy === user.id);
      return send(res, 200, {
        code: user.uid || user.id,
        link: `/?ref=${encodeURIComponent(user.uid || user.id)}`,
        invited: invited.length,
        qualified: invited.filter((x) => x.refRewarded).length,
        earned: user.refEarned || 0,
        rewardPerFriend: 5,
        minTopup: 100,
        maxFriends: 10,
      });
    }

    // ---------- แนบสลิปยืนยันการเติมเงิน ----------
    if (pathname === '/api/topup-confirm' && req.method === 'POST') {
      if (!user) return send(res, 401, { error: 'กรุณาเข้าสู่ระบบ' });
      if (!rateLimit(`confirm:${user.id}`, 15, 60_000)) return send(res, 429, { error: 'พยายามบ่อยเกินไป' });
      const body = JSON.parse(await readBody(req, 6 * 1024 * 1024));
      const t = topups.find((x) => x.id === body.id && x.userId === user.id);
      if (!t) return send(res, 404, { error: 'ไม่พบรายการเติมเงินนี้' });
      if (body.ref !== undefined) t.ref = String(body.ref || '').trim().slice(0, 100);

      if (body.slip) {
        const m = String(body.slip).match(/^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/);
        if (!m) return send(res, 400, { error: 'รูปสลิปต้องเป็นไฟล์ PNG / JPG / WEBP / GIF เท่านั้น' });
        if (m[2].length > 4.5 * 1024 * 1024) return send(res, 400, { error: 'รูปสลิปใหญ่เกินไป (สูงสุด ~3MB)' });
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1] === 'png' ? 'png' : m[1];
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length < 50) return send(res, 400, { error: 'ไฟล์รูปไม่ถูกต้อง' });
        const slipsDir = path.join(DATA, 'slips');
        fs.mkdirSync(slipsDir, { recursive: true });
        // มีสลิปเดิมอยู่แล้ว (แนบใหม่อีกรอบ) → เขียนทับชื่อเดิม
        t.slipFile = `${t.id}.${ext}`;
        fs.writeFileSync(path.join(slipsDir, t.slipFile), buf);
      }
      t.confirmedAt = Date.now();
      persist.topups();
      // แจ้งเตือนทุกอุปกรณ์แอดมินทันที (ไม่บล็อกคำตอบลูกค้า)
      notifyAdmins({
        title: 'มีรายการเติมเงินรออนุมัติ',
        body: `${t.username} แจ้งโอน ${t.amount.toLocaleString()} บาท${t.slipFile ? ' (แนบสลิปมาด้วย)' : ''} — แตะเพื่อเข้าไปอนุมัติ`,
        tag: 'topup-' + t.id,
        url: '/admin',
      }).catch(() => {});
      return send(res, 200, { ok: true, topup: t });
    }

    // ---------- โปรไฟล์ของฉัน ----------
    if (pathname === '/api/profile' && req.method === 'GET') {
      if (!user) return send(res, 401, { error: 'กรุณาเข้าสู่ระบบ' });
      const mine = orders.filter((o) => o.userId === user.id);
      return send(res, 200, {
        user: publicUser(user),
        stats: {
          totalOrders: mine.length,
          completed: mine.filter((o) => o.status === 'Completed').length,
          processing: mine.filter((o) => ['Pending', 'Processing'].includes(o.status)).length,
          spent: Math.round(mine.filter((o) => o.status !== 'Error').reduce((s, o) => s + o.price, 0) * 100) / 100,
          topupTotal: Math.round(topups.filter((t) => t.userId === user.id && t.status === 'approved').reduce((s, t) => s + t.amount, 0) * 100) / 100,
          topupCount: topups.filter((t) => t.userId === user.id && t.status === 'approved').length,
        },
      });
    }

    if (pathname === '/api/profile' && req.method === 'POST') {
      if (!user) return send(res, 401, { error: 'กรุณาเข้าสู่ระบบ' });
      const body = JSON.parse(await readBody(req));
      if (body.name !== undefined) {
        const name = String(body.name).trim().slice(0, 60);
        if (name) user.name = name;
      }
      if (body.phone !== undefined) {
        const phone = normalizePhone(body.phone);
        if (!PHONE_RE.test(phone)) return send(res, 400, { error: 'รูปแบบเบอร์โทรไม่ถูกต้อง (เช่น 0812345678)' });
        user.phone = phone;
      }
      if (body.newPassword) {
        const newPw = String(body.newPassword);
        if (newPw.length < 4) return send(res, 400, { error: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 4 ตัวอักษร' });
        if (!verifyPassword(user, String(body.oldPassword || ''))) return send(res, 400, { error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
        user.salt = crypto.randomBytes(16).toString('hex');
        user.passHash = hashPassword(newPw, user.salt);
      }
      persist.users();
      return send(res, 200, { ok: true, user: publicUser(user) });
    }

    // ---------- เติมเงิน ----------
    if (pathname === '/api/topup' && req.method === 'POST') {
      if (!user) return send(res, 401, { error: 'กรุณาเข้าสู่ระบบ' });
      if (!rateLimit(`topup:${user.id}`, 10, 60_000)) return send(res, 429, { error: 'พยายามบ่อยเกินไป' });
      const body = JSON.parse(await readBody(req));
      const amount = Number(body.amount);
      const minT = Number(settings.topupMin || 10);
      const maxT = Number(settings.topupMax || 100000);
      if (!isFinite(amount) || amount < minT || amount > maxT)
        return send(res, 400, { error: `ยอดเติมต้องอยู่ระหว่าง ${minT.toLocaleString()} - ${maxT.toLocaleString()} บาท` });
      const payload = qrPayloadFor(amount);
      if (!payload) return send(res, 400, { error: 'ระบบยังไม่ได้ตั้งค่าพร้อมเพย์ กรุณาติดต่อแอดมิน' });
      meta.topupSeq += 1;
      const t = {
        id: 'T' + String(meta.topupSeq).padStart(6, '0'),
        userId: user.id,
        username: user.username,
        amount: Math.round(amount * 100) / 100,
        ref: String(body.ref || '').trim().slice(0, 100),
        status: 'pending',
        createdAt: Date.now(),
      };
      topups.push(t);
      persist.topups();
      persist.meta();
      return send(res, 200, { ok: true, topup: t, qr: payload });
    }

    if (pathname === '/api/topups' && req.method === 'GET') {
      if (!user) return send(res, 401, { error: 'กรุณาเข้าสู่ระบบ' });
      const mine = topups.filter((t) => t.userId === user.id).sort((a, b) => b.createdAt - a.createdAt);
      return send(res, 200, { topups: mine });
    }

    if (pathname === '/api/qr' && req.method === 'GET') {
      const amount = Number(url.searchParams.get('amount') || 0);
      const payload = qrPayloadFor(isFinite(amount) && amount > 0 ? amount : 0);
      if (!payload) return send(res, 400, { error: 'ยังไม่ได้ตั้งค่าพร้อมเพย์' });
      return send(res, 200, { qr: payload });
    }

    // ============================================================
    //  ส่วนแอดมิน — ต้องล็อกอินด้วยรหัสผ่านแอดมินเท่านั้น
    // ============================================================
    if (pathname === '/api/admin/login' && req.method === 'POST') {
      if (!rateLimit(`admin:${ip}`, 8, 60_000)) return send(res, 429, { error: 'พยายามบ่อยเกินไป' });
      const body = JSON.parse(await readBody(req));
      const expect = String(process.env.ADMIN_PASSWORD || '');
      const got = String(body.password || '');
      if (!expect || got !== expect) return send(res, 401, { error: 'รหัสผ่านแอดมินไม่ถูกต้อง' });
      const sid = newSession({ isAdmin: true, adminExpires: Date.now() + ADMIN_TTL });
      setCookie(res, 'admin_sid', sid, Math.floor(ADMIN_TTL / 1000));
      return send(res, 200, { ok: true });
    }

    if (pathname === '/api/admin/logout' && req.method === 'POST') {
      destroySession(cookies.admin_sid);
      clearCookie(res, 'admin_sid');
      return send(res, 200, { ok: true });
    }

    if (pathname.startsWith('/api/admin/') && !isAdmin) {
      return send(res, 403, { error: 'ต้องเป็นแอดมิน' });
    }

    if (pathname === '/api/admin/overview' && req.method === 'GET') {
      const bal = await getBalance().catch(() => ({ error: 'เชื่อมต่อล้มเหลว' }));
      const done = orders.filter((o) => o.status === 'Completed');
      // รายได้/ต้นทุน นับเฉพาะออเดอร์ที่สำเร็จจริง (Completed + Partial) — ยกเลิก/คืนเงิน/กำลังดำเนินการไม่นับ
      const earned = orders.filter((o) => ['Completed', 'Partial'].includes(o.status));
      const revenue = earned.reduce((s, o) => s + o.price, 0);
      const cost = earned.reduce((s, o) => s + (Number(o.charge) ?? o.estCost ?? 0), 0);
      // ลิงก์เติมเครดิตต้นทาง + ช่องทางติดต่อ — เปลี่ยนตามผู้ให้บริการที่ใช้อยู่อัตโนมัติ
      const PROVIDER_INFO = {
        kmm: { topupUrl: 'https://kmm-th.com/', contactLabel: 'LINE @KMM-TH', contactUrl: 'https://line.me/R/ti/p/@KMM-TH' },
        smm24hr: { topupUrl: 'https://www.smm24hr.net/', contactLabel: 'อีเมล shout@smm24hr.net', contactUrl: 'mailto:shout@smm24hr.net' },
      };
      const pinfo = PROVIDER_INFO[PROVIDER_NAME] || PROVIDER_INFO.kmm;
      return send(res, 200, {
        upstream: { ...bal, provider: PROVIDER_NAME, ...pinfo },
        servicesAt: meta.servicesAt || null,
        stats: {
          users: Object.keys(users).length,
          orders: orders.length,
          pendingTopups: topups.filter((t) => t.status === 'pending').length,
          revenue: Math.round(revenue * 100) / 100,
          cost: Math.round(cost * 100) / 100,
          profit: Math.round((revenue - cost) * 100) / 100,
          userCredits: Math.round(Object.values(users).reduce((s, u) => s + u.balance, 0) * 100) / 100,
          services: servicesRaw.length,
          hiddenServices: blockedIds().length,
        },
        settings,
      });
    }

    if (pathname === '/api/admin/settings' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
      if ('markupPercent' in body) settings.markupPercent = Math.max(0, Math.min(1000, num(body.markupPercent, settings.markupPercent)));
      if ('minPer1000' in body) settings.minPer1000 = Math.max(0, num(body.minPer1000, settings.minPer1000));
      if ('minOrderPrice' in body) settings.minOrderPrice = Math.max(0, num(body.minOrderPrice, settings.minOrderPrice));
      if ('siteName' in body) settings.siteName = String(body.siteName || '').slice(0, 60);
      if ('tagline' in body) settings.tagline = String(body.tagline || '').slice(0, 160);
      if ('promptPayId' in body) settings.promptPayId = String(body.promptPayId || '').replace(/\s/g, '').slice(0, 20);
      if ('topupMin' in body) settings.topupMin = Math.max(1, Math.floor(num(body.topupMin, settings.topupMin)));
      if ('topupMax' in body) settings.topupMax = Math.max(Number(settings.topupMin || 1), Math.floor(num(body.topupMax, settings.topupMax)));
      if ('topupAmounts' in body) {
        const arr = String(body.topupAmounts || '')
          .split(',')
          .map((x) => Number(x.trim()))
          .filter((n) => Number.isFinite(n) && n >= 1)
          .slice(0, 8)
          .map((n) => Math.floor(n));
        if (arr.length >= 1) settings.topupAmounts = arr.join(',');
      }
      if ('lineContact' in body) settings.lineContact = String(body.lineContact || '').slice(0, 60);
      persist.settings();
      return send(res, 200, { ok: true, settings });
    }

    if (pathname === '/api/admin/topups' && req.method === 'GET') {
      const REF_REWARD = 5, REF_MIN_TOPUP = 100, REF_MAX_FRIENDS = 10;
      const list = [...topups].sort((a, b) => b.createdAt - a.createdAt).map((t) => {
        const item = { ...t };
        if (t.status === 'pending') {
          const u = users[t.userId];
          if (u && u.refBy && !u.refRewarded && t.amount >= REF_MIN_TOPUP) {
            const hadApproved = topups.some((x) => x.userId === u.id && x.status === 'approved');
            const r = users[u.refBy];
            if (!hadApproved && r && (r.refCount || 0) < REF_MAX_FRIENDS) {
              item.refReward = {
                amount: REF_REWARD,
                referrerName: r.name || r.username,
                referrerUid: r.uid || null,
                note: `เติมแรกของ ${u.username} ≥ ${REF_MIN_TOPUP}฿ ผ่านลิงก์แนะนำ`,
              };
            }
          }
        }
        return item;
      });
      return send(res, 200, { topups: list });
    }

    if (pathname === '/api/admin/topup-action' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const t = topups.find((x) => x.id === body.id);
      if (!t) return send(res, 404, { error: 'ไม่พบรายการเติมเงิน' });
      if (t.status !== 'pending') return send(res, 400, { error: 'รายการนี้ดำเนินการไปแล้ว' });
      const u = users[t.userId];
      if (body.action === 'approve') {
        t.status = 'approved';
        t.decidedAt = Date.now();
        if (u) {
          const hadApprovedTopup = topups.some((x) => x.userId === u.id && x.status === 'approved' && x.id !== t.id);
          u.balance = Math.round((u.balance + t.amount) * 100) / 100;
          persist.users();
          // รางวัลแนะนำเพื่อน: เติมครั้งแรกของเพื่อน >= 100 บาท → ผู้แนะนำได้ 5 บาท (ครั้งเดียวต่อเพื่อน สูงสุด 10 เพื่อน)
          const REF_REWARD = 5, REF_MIN_TOPUP = 100, REF_MAX_FRIENDS = 10;
          if (!hadApprovedTopup && t.amount >= REF_MIN_TOPUP && u.refBy && !u.refRewarded) {
            const r = users[u.refBy];
            if (r && (r.refCount || 0) < REF_MAX_FRIENDS) {
              r.balance = Math.round((r.balance + REF_REWARD) * 100) / 100;
              r.refCount = (r.refCount || 0) + 1;
              r.refEarned = Math.round(((r.refEarned || 0) + REF_REWARD) * 100) / 100;
              u.refRewarded = true;
              persist.users();
            }
          }
        }
      } else if (body.action === 'reject') {
        t.status = 'rejected';
        t.decidedAt = Date.now();
      } else {
        return send(res, 400, { error: 'action ไม่ถูกต้อง' });
      }
      persist.topups();
      return send(res, 200, { ok: true, topup: t });
    }

    if (pathname === '/api/admin/orders' && req.method === 'GET') {
      if (url.searchParams.get('refresh') === '1') {
        await refreshOrders(null, true);
      }
      const list = [...orders].sort((a, b) => b.createdAt - a.createdAt).slice(0, 500);
      return send(res, 200, { orders: list });
    }

    if (pathname === '/api/admin/messages' && req.method === 'GET') {
      const list = [...messages]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 300)
        .map((t) => ({
          id: t.id, username: t.username, name: t.name, contact: t.contact,
          userUid: t.userId ? users[t.userId]?.uid || null : null,
          topic: t.topic || null, issueType: t.issueType || null,
          productCode: t.productCode || null,
          orderLink: t.orderLink || null, issueDate: t.issueDate || null,
          status: t.status, read: t.readByAdmin,
          last: t.messages[t.messages.length - 1],
          count: t.messages.length,
          createdAt: t.createdAt, updatedAt: t.updatedAt,
        }));
      return send(res, 200, { messages: list, unread: messages.filter((t) => t.status === 'open' && !t.readByAdmin).length });
    }

    // ---------- ประกาศถึงลูกค้า ----------
    if (pathname === '/api/announces' && req.method === 'GET') {
      const list = [...announces].sort((a, b) => b.at - a.at).slice(0, 10);
      return send(res, 200, { announces: list });
    }

    if (pathname === '/api/admin/announce' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const text = String(body.text || '').trim().slice(0, 500);
      if (text.length < 2) return send(res, 400, { error: 'พิมพ์ข้อความอย่างน้อย 2 ตัวอักษร' });
      announces.push({ id: 'N' + Date.now().toString(36), text, important: !!body.important, at: Date.now() });
      persist.announces();
      return send(res, 200, { ok: true });
    }

    if (pathname === '/api/admin/announce-toggle-important' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const a = announces.find((x) => x.id === String(body.id || ''));
      if (!a) return send(res, 404, { error: 'ไม่พบประกาศนี้' });
      a.important = !a.important;
      persist.announces();
      return send(res, 200, { ok: true, important: a.important });
    }

    if (pathname === '/api/admin/announce-edit' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const a = announces.find((x) => x.id === String(body.id || ''));
      if (!a) return send(res, 404, { error: 'ไม่พบประกาศนี้' });
      const text = String(body.text || '').trim().slice(0, 500);
      if (text.length < 2) return send(res, 400, { error: 'พิมพ์ข้อความอย่างน้อย 2 ตัวอักษร' });
      a.text = text;
      if (body.important !== undefined) a.important = !!body.important;
      a.editedAt = Date.now();
      persist.announces();
      return send(res, 200, { ok: true });
    }

    if (pathname === '/api/admin/announce-delete' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const idx = announces.findIndex((a) => a.id === String(body.id || ''));
      if (idx !== -1) {
        announces.splice(idx, 1);
        persist.announces();
      }
      return send(res, 200, { ok: true });
    }

    if (pathname === '/api/admin/message-action' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const t = messages.find((m) => m.id === String(body.id || ''));
      if (!t) return send(res, 404, { error: 'ไม่พบเคสนี้' });
      if (body.action === 'delete') {
        messages.splice(messages.indexOf(t), 1);
      } else if (body.action === 'close') {
        t.status = 'closed';
        t.updatedAt = Date.now();
      } else if (body.action === 'open') {
        t.status = 'open';
        t.updatedAt = Date.now();
      } else {
        t.readByAdmin = true;
      }
      persist.messages();
      return send(res, 200, { ok: true, unread: messages.filter((m) => m.status === 'open' && !m.readByAdmin).length });
    }

    // แอดมินเปิดดูบทสนทนาเต็ม + ตอบกลับลูกค้า
    if (pathname === '/api/admin/ticket-thread' && req.method === 'GET') {
      const t = messages.find((m) => m.id === url.searchParams.get('id'));
      if (!t) return send(res, 404, { error: 'ไม่พบเคสนี้' });
      t.readByAdmin = true;
      persist.messages();
      return send(res, 200, { ticket: { id: t.id, username: t.username, name: t.name, contact: t.contact, topic: t.topic || null, issueType: t.issueType || null, productCode: t.productCode || null, orderLink: t.orderLink || null, issueDate: t.issueDate || null, status: t.status, messages: t.messages, updatedAt: t.updatedAt } });
    }

    if (pathname === '/api/admin/ticket-reply' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const t = messages.find((m) => m.id === String(body.id || ''));
      if (!t) return send(res, 404, { error: 'ไม่พบเคสนี้' });
      if (t.status === 'closed') return send(res, 400, { error: 'เคสนี้ปิดแล้ว — เปิดเคสก่อนตอบกลับ' });
      const text = String(body.text || '').trim().slice(0, 2000);
      if (text.length < 1) return send(res, 400, { error: 'พิมพ์ข้อความก่อนส่ง' });
      t.messages.push({ from: 'admin', text, at: Date.now() });
      t.updatedAt = Date.now();
      t.readByAdmin = true;
      t.readByCustomer = false;
      persist.messages();
      return send(res, 200, { ok: true });
    }

    if (pathname === '/api/admin/users' && req.method === 'GET') {
      const list = Object.values(users)
        .map((u) => ({
          ...publicUser(u),
          orderCount: orders.filter((o) => o.userId === u.id).length,
          refCount: u.refCount || 0,
          refEarned: u.refEarned || 0,
          refByUid: u.refBy ? users[u.refBy]?.uid || null : null,
        }))
        .sort((a, b) => b.createdAt - a.createdAt);
      return send(res, 200, { users: list });
    }

    if (pathname === '/api/admin/credit' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const u = users[String(body.username || '').toLowerCase()];
      if (!u) return send(res, 404, { error: 'ไม่พบผู้ใช้' });
      const amount = Number(body.amount);
      if (!isFinite(amount) || amount === 0) return send(res, 400, { error: 'จำนวนเงินไม่ถูกต้อง' });
      u.balance = Math.round((u.balance + amount) * 100) / 100;
      persist.users();
      return send(res, 200, { ok: true, user: publicUser(u) });
    }

    // ---------- แอดมิน: จัดการสมาชิก (แก้ไข/ลบ) ----------
    if (pathname === '/api/admin/user-update' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const u = users[String(body.username || '').toLowerCase()];
      if (!u) return send(res, 404, { error: 'ไม่พบผู้ใช้' });
      if (body.name !== undefined) {
        const name = String(body.name).trim().slice(0, 60);
        if (name) u.name = name;
      }
      if (body.balance !== undefined) {
        const b = Number(body.balance);
        if (!isFinite(b) || b < 0) return send(res, 400, { error: 'เครดิตต้องเป็นตัวเลขไม่ติดลบ' });
        u.balance = Math.round(b * 100) / 100;
      }
      if (body.password) {
        const pw = String(body.password);
        if (pw.length < 4) return send(res, 400, { error: 'รหัสผ่านต้องยาวอย่างน้อย 4 ตัวอักษร' });
        u.salt = crypto.randomBytes(16).toString('hex');
        u.passHash = hashPassword(pw, u.salt);
      }
      persist.users();
      return send(res, 200, { ok: true, user: publicUser(u) });
    }

    if (pathname === '/api/admin/user-delete' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const uid = String(body.username || '').toLowerCase();
      if (!users[uid]) return send(res, 404, { error: 'ไม่พบผู้ใช้' });
      // ประวัติออร์เดอร์/เติมเงินเก็บไว้เป็นหลักฐานบัญชี (แสดงเฉพาะชื่อผู้ใช้) แต่เซสชันของคนนี้ต้องตาย
      delete users[uid];
      for (const sid of Object.keys(sessions)) {
        if (sessions[sid].userId === uid) delete sessions[sid];
      }
      persist.users();
      persist.sessions();
      return send(res, 200, { ok: true });
    }

    // ---------- แอดมิน: จัดการคำสั่งซื้อ (แก้สถานะ/ลบ) ----------
    if (pathname === '/api/admin/order-update' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const o = orders.find((x) => x.id === body.id);
      if (!o) return send(res, 404, { error: 'ไม่พบออเดอร์' });
      const allowed = ['Pending', 'Processing', 'Completed', 'Partial', 'Canceled', 'Refunded', 'Error'];
      if (!allowed.includes(body.status)) return send(res, 400, { error: 'สถานะไม่ถูกต้อง' });
      o.status = body.status;
      o.statusRaw = body.status + ' (แก้โดยแอดมิน)';
      o.updatedAt = Date.now();
      // แก้เป็นคืนเงิน/ยกเลิกด้วยมือ → คืนเครดิตลูกค้าทันที (ครั้งเดียวต่อออเดอร์)
      // กรณียกเลิก: หักส่วนที่ต้นทางเรียกเก็บจริง (charge) แล้วคืนส่วนที่เหลือตามสัดส่วน
      if ((o.status === 'Refunded' || o.status === 'Canceled') && !o.refundedToUser) {
        const charged = Number(o.charge || 0);
        const cost = Number(o.estCost || 0);
        let back = o.price;
        if (o.status === 'Canceled' && charged > 0 && cost > 0) back = Math.max(0, Math.round(o.price * (1 - charged / cost) * 100) / 100);
        if (back > 0) {
          const u = users[o.userId];
          if (u) {
            u.balance = Math.round((u.balance + back) * 100) / 100;
            o.refundedToUser = true;
            o.refundedAmount = back;
            o.error = o.status === 'Canceled' ? `ยกเลิกรายการ — ระบบคืนเครดิต ${back.toFixed(2)} บาทแล้ว` : 'แอดมินคืนเครดิตรายการนี้';
            persist.users();
          }
        } else {
          o.refundedToUser = true; // ต้นทางหักเต็มแล้ว ไม่มีส่วนต้องคืน
        }
      }
      persist.orders();
      return send(res, 200, { ok: true, order: o });
    }

    if (pathname === '/api/admin/order-delete' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const idx = orders.findIndex((x) => x.id === body.id);
      if (idx === -1) return send(res, 404, { error: 'ไม่พบออเดอร์' });
      orders.splice(idx, 1);
      persist.orders();
      return send(res, 200, { ok: true });
    }

    // ---------- แอดมิน: จัดการรายการเติมเงิน (แก้ยอด/อ้างอิง + ลบ) ----------
    if (pathname === '/api/admin/topup-update' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const t = topups.find((x) => x.id === body.id);
      if (!t) return send(res, 404, { error: 'ไม่พบรายการเติมเงิน' });
      if (t.status === 'approved') return send(res, 400, { error: 'รายการอนุมัติแล้วแก้ไม่ได้ (ต้องการแก้ให้ลบแล้วให้ลูกค้าแจ้งใหม่)' });
      if (body.amount !== undefined) {
        const a = Number(body.amount);
        if (!isFinite(a) || a <= 0) return send(res, 400, { error: 'ยอดเงินไม่ถูกต้อง' });
        t.amount = Math.round(a * 100) / 100;
      }
      if (body.ref !== undefined) t.ref = String(body.ref || '').trim().slice(0, 100);
      persist.topups();
      return send(res, 200, { ok: true, topup: t });
    }

    if (pathname === '/api/admin/topup-delete' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const idx = topups.findIndex((x) => x.id === body.id);
      if (idx === -1) return send(res, 404, { error: 'ไม่พบรายการเติมเงิน' });
      const t = topups[idx];
      if (t.status === 'approved') return send(res, 400, { error: 'รายการที่อนุมัติไปแล้วห้ามลบ (กระทบยอดบัญชี) — ใช้ปรับเครดิตสมาชิกแทน' });
      if (t.slipFile) {
        const slipPath = path.join(DATA, 'slips', t.slipFile);
        fs.rm(slipPath, { force: true }, () => {});
      }
      topups.splice(idx, 1);
      persist.topups();
      return send(res, 200, { ok: true });
    }

    // ---------- ระบบแจ้งเตือน push ----------
    if (pathname === '/api/push/vapidkey' && req.method === 'GET') {
      return send(res, 200, { key: getPublicKey() });
    }

    if (pathname === '/api/push/subscribe' && req.method === 'POST') {
      if (!isAdmin) return send(res, 403, { error: 'ต้องเป็นแอดมิน' });
      const body = JSON.parse(await readBody(req));
      if (!body || !body.endpoint) return send(res, 400, { error: 'ข้อมูล subscription ไม่ถูกต้อง' });
      addSub(body);
      return send(res, 200, { ok: true });
    }

    if (pathname === '/api/push/test' && req.method === 'POST') {
      if (!isAdmin) return send(res, 403, { error: 'ต้องเป็นแอดมิน' });
      const r = await notifyAdmins({
        title: 'ทดสอบการแจ้งเตือน',
        body: 'ถ้าเห็นข้อความนี้ แปลว่าระบบแจ้งเตือนพร้อมใช้งาน',
        tag: 'test',
        url: '/admin',
      }).catch((e) => ({ error: e.message }));
      return send(res, 200, { ok: true, result: r });
    }

    if (pathname === '/api/admin/services-refresh' && req.method === 'POST') {
      const fresh = await scanAllServices(140);
      if (fresh.length >= 10) {
        servicesRaw = fresh;
        meta.servicesAt = Date.now();
        persist.services();
        persist.meta();
      }
      return send(res, 200, { ok: true, count: servicesRaw.length, generatedAt: meta.servicesAt });
    }

    return send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error('[server]', err);
    send(res, 500, { error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// ---------------- helpers ที่ใช้ใน router ----------------
function orderForCustomer(o) {
  // ตัดทุก field ที่เกี่ยวกับต้นทุน/upstream ออก กันข้อมูลรั่วไหล
  return {
    id: o.id,
    upstreamOrder: o.upstreamOrder, // รหัสคำสั่งซื้อ/เลขเคสที่ต้นทาง (ลูกค้าแนบไปแจ้งได้)
    serviceId: o.serviceId,
    serviceName: o.serviceName,
    category: o.category,
    link: o.link,
    quantity: o.quantity,
    price: o.price,
    status: o.status,
    remains: o.remains,
    startCount: o.startCount,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    error: o.error || null,
  };
}
function publicSettings() {
  return {
    siteName: settings.siteName,
    tagline: settings.tagline,
    hasPromptPay: !!settings.promptPayId,
    lineContact: settings.lineContact,
    minOrderPrice: settings.minOrderPrice,
    topupMin: Number(settings.topupMin || 10),
    topupMax: Number(settings.topupMax || 100000),
    topupAmounts: String(settings.topupAmounts || '50,100,200,500,1000')
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n) && n >= 1),
  };
}
// ---------------- static files ----------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
function serveStatic(pathname, res) {
  let file = pathname === '/' ? '/index.html' : pathname;
  if (file === '/admin' || file === '/admin/') file = '/admin.html';
  const full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 ไม่พบหน้านี้');
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // no-cache ทุกไฟล์ — ไฟล์เล็กอยู่แล้ว กันปัญหาแก้โค้ดแล้วผู้ใช้ได้ของเก่าจากแคช
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

// ---------------- start ----------------
// seed บล็อกจากออร์เดอร์ล้มเหลวล่าสุด (24 ชม.) กรณีต้นทางปิดบริการ
(function seedBlocksFromRecentErrors() {
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  let seeded = 0;
  for (const o of orders) {
    if (o.status === 'Error' && o.createdAt > dayAgo && errorMeansUnavailable(o.error)) {
      const id = String(o.serviceId);
      if (!serviceBlocks[id] || serviceBlocks[id] < Date.now()) { serviceBlocks[id] = Date.now() + BLOCK_MS; seeded++; }
    }
  }
  if (seeded) saveJSON('service-blocks.json', serviceBlocks);
  if (seeded) console.log(`   🚫 ซ่อนบริการชั่วคราว ${seeded} รายการ (ต้นทางปิดอยู่)`);
})();

// ---------- ตรวจยอดออเดอร์อัตโนมัติ: ต้นทางคืนเงิน = คืนเครดิตลูกค้าทันที แม้ไม่มีใครเปิดหน้าเว็บ ----------
async function reconcileOrders() {
  try { await refreshOrders(null, true); } catch { /* รอรอบหน้า */ }
}
// เคสค้าง: สถานะเป็น Canceled/Refunded แล้วแต่ยังไม่ได้คืนเครดิต (เช่นเกิดตอนเซิร์ฟเวอร์ปิด) — ดึงสถานะใหม่แล้วคืนให้ครบ
async function reconcileStuckRefunds() {
  const need = orders.filter(
    (o) => o.upstreamOrder && !o.refundedToUser && ['Canceled', 'Refunded'].includes(String(o.status))
  );
  if (!need.length) return;
  let userChanged = false;
  for (let i = 0; i < need.length; i += 50) {
    const chunk = need.slice(i, i + 50);
    let map = null;
    try { map = await orderStatusBatch(chunk.map((o) => o.upstreamOrder)); } catch { continue; }
    for (const o of chunk) {
      const st = map && map[o.upstreamOrder];
      if (!st) continue;
      if (st.charge !== undefined) o.charge = st.charge;
      o.statusRaw = st.status ?? o.statusRaw;
      o.status = normalizeStatus(st.status);
      o.updatedAt = Date.now();
      if ((o.status === 'Refunded' || o.status === 'Canceled') && !o.refundedToUser) {
        const charged = Number(o.charge || 0);
        const cost = Number(o.estCost || 0);
        let back = o.price;
        if (charged > 0 && cost > 0) back = Math.max(0, Math.round(o.price * (1 - charged / cost) * 100) / 100);
        if (back > 0) {
          const u = users[o.userId];
          if (u) {
            u.balance = Math.round((u.balance + back) * 100) / 100;
            o.refundedToUser = true;
            o.refundedAmount = back;
            o.error = o.status === 'Canceled'
              ? `ผู้ให้บริการยกเลิกรายการนี้ ระบบคืนเครดิต ${back.toFixed(2)} บาทแล้ว`
              : 'ผู้ให้บริการคืนเงินรายการนี้ ระบบคืนเครดิตให้แล้ว';
            userChanged = true;
          }
        } else {
          o.refundedToUser = true;
        }
      }
    }
  }
  persist.orders();
  if (userChanged) persist.users();
}
setTimeout(() => { reconcileOrders(); reconcileStuckRefunds(); }, 20_000); // ตอนบูต 20 วิแรก ตรวจทันที
setInterval(() => { reconcileOrders(); reconcileStuckRefunds(); }, 5 * 60_000); // แล้วตรวจซ้ำทุก 5 นาที

server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log(`🚀 ${settings.siteName} กำลังทำงานที่ http://localhost:${PORT}`);
  console.log(`   หน้าร้าน:  http://localhost:${PORT}`);
  console.log(`   หน้าแอดมิน: http://localhost:${PORT}/admin`);
  if (!servicesRaw.length) {
    console.log('   ⏳ กำลังดึงรายการบริการครั้งแรก...');
    scanAllServices(140).then((fresh) => {
      servicesRaw = fresh;
      meta.servicesAt = Date.now();
      persist.services();
      persist.meta();
      console.log(`   ✅ ดึงบริการเสร็จแล้ว ${fresh.length} รายการ`);
    });
  } else {
    console.log(`   📦 บริการในระบบ ${servicesRaw.length} รายการ`);
    // รีเฟรชเงียบๆ ถ้าข้อมูลเก่าเกิน 12 ชม.
    if (!meta.servicesAt || Date.now() - meta.servicesAt > 12 * 3600 * 1000) {
      scanAllServices(140).then((fresh) => {
        if (fresh.length >= 10) {
          servicesRaw = fresh;
          meta.servicesAt = Date.now();
          persist.services();
          persist.meta();
          console.log(`   🔄 รีเฟรชบริการเป็นล่าสุดแล้ว (${fresh.length} รายการ)`);
        }
      });
    }
  }
});
