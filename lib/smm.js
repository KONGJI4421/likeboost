// ตัวเชื่อมต่อ upstream — ใช้ได้เฉพาะฝั่งเซิร์ฟเวอร์เท่านั้น
// API Key อ่านจาก process.env เท่านั้น ห้ามส่งออกไปยัง browser เด็ดขาด
// รองรับ 2 รูปแบบ: smm24hr (JSON เฉพาะของเขา) และมาตรฐานสากล v2 (form-urlencoded เช่น kmm-th)
import fs from 'node:fs';

function loadEnv() {
  try {
    const txt = fs.readFileSync('.env', 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
    }
  } catch {
    /* ไม่มี .env ก็ปล่อยให้ env จริงเป็นตัวกำหนด */
  }
}
loadEnv();

const PRESETS = {
  smm24hr: { endpoint: 'https://api.smm24hr.net/partner/functions', format: 'json', fullCatalog: false },
  kmm: { endpoint: 'https://kmm-th.com/api/v2', format: 'form', fullCatalog: true },
};
const PROVIDER = (process.env.SMM_PROVIDER || 'smm24hr').toLowerCase();
export const PROVIDER_NAME = PROVIDER;
const conf = PRESETS[PROVIDER] || PRESETS.smm24hr;
const ENDPOINT = process.env.SMM_ENDPOINT || conf.endpoint;
const FORMAT = process.env.SMM_FORMAT || conf.format;

export async function smm(action, extra = {}, timeoutMs = 20000) {
  const body = { key: process.env.SMM_API_KEY, action, ...extra };
  const isForm = FORMAT === 'form';
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': isForm ? 'application/x-www-form-urlencoded' : 'application/json',
    },
    body: isForm ? new URLSearchParams(body).toString() : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => ({ error: 'bad_json' }));
  return json;
}

export const getBalance = () => smm('balance');
export const getService = (id) => smm('services', { service: String(id) });
export const getServicesBatch = (ids) => smm('services', { services: ids.map(String).join(',') });
export const addOrder = ({ service, link, quantity }) =>
  smm('add', { service: String(service), link: String(link), quantity: Number(quantity) }, 45000);
export const orderStatus = (order) => smm('status', { order: String(order) });
export const orderStatusBatch = (orders) => smm('status', { orders: orders.map(String).join(',') });

// ข้อความ error ที่แปลว่า "บริการนี้ปิดอยู่" — ใช้ตัดสินว่าจะเกรย์บริการไว้กันลูกค้าชนซ้ำหรือไม่
// (เงินไม่พอ/ลิงก์ผิด ห้ามเข้าเงื่อนไขนี้ เพราะไม่ใช่ความผิดของตัวบริการ)
const UNAVAILABLE_PATTERNS = [/ไม่พร้อมให้บริการ/i, /maintenance/i, /not available/i, /unavailable/i, /incorrect service/i];
export const errorMeansUnavailable = (err) => UNAVAILABLE_PATTERNS.some((re) => re.test(String(err || '')));

// catalog: v2 มาตรฐานตอบทั้งหมดในคำสั่งเดียว — smm24hr ต้องไล่สแกนเป็นชุด (API รับชุดละไม่เกิน 50)
export async function scanAllServices(maxId = 140) {
  if (conf.fullCatalog) {
    const r = await smm('services');
    return (Array.isArray(r) ? r : [])
      .filter((s) => s && s.service)
      .sort((a, b) => Number(a.service) - Number(b.service));
  }
  const chunks = [];
  for (let i = 1; i <= maxId; i += 50) {
    const ids = [];
    for (let j = i; j < i + 50 && j <= maxId; j++) ids.push(j);
    chunks.push(ids);
  }
  const results = await Promise.all(
    chunks.map((ids) => getServicesBatch(ids).catch(() => []))
  );
  const found = results
    .flat()
    .filter((s) => s && s.service)
    .sort((a, b) => Number(a.service) - Number(b.service));
  return found;
}
