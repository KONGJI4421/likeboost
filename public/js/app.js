/* ===== LikeBoost — ฝั่งลูกค้า ===== */
const $ = (id) => document.getElementById(id);
// เก็บรหัสผู้แนะนำจากลิงก์ ?ref=... ไว้ใช้ตอนสมัคร (เก็บ 30 วัน)
try {
  const p = new URLSearchParams(location.search);
  const ref = p.get('ref');
  if (ref) localStorage.setItem('lb_ref', ref);
} catch {}

const state = {
  me: null,
  settings: {},
  services: [],
  cats: [],
  cat: 'all',
  platform: 'all',
  search: '',
  selectedService: null,
  topupAmount: 100,
  pendingTopup: null,
  authMode: 'login',
  hideClosed: localStorage.getItem('lb_hideClosed') !== '0', // ค่าเริ่มต้น: แสดงเฉพาะบริการที่เปิดให้สั่งได้
  renderLimit: 60, // ทยอยโหลดการ์ด กัน DOM หนักเกินบนมือถือ (catalog ใหญ่ขึ้นหลายเท่า)
};

// ลิสต์บริการที่ใช้แสดงผล — เช็คสถานะบริการปิดชั่วคราว (disabled) จากฝั่งเซิร์ฟเวอร์
const activeServices = () => (state.hideClosed ? state.services.filter((s) => !s.disabled) : state.services);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (ts) => new Date(ts).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({ error: 'ระบบผิดพลาด' }));
  if (!res.ok) throw new Error(json.error || 'เกิดข้อผิดพลาด');
  return json;
}


// ---------- โหมดมืด-สว่าง ----------
(function initTheme() {
  const LIGHT = '#f4511e';
  const btn = $('themeBtn');
  const sync = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (btn) {
      const moon = btn.querySelector('.ico-moon');
      const sun = btn.querySelector('.ico-sun');
      if (moon && sun) { moon.style.display = dark ? 'none' : ''; sun.style.display = dark ? '' : 'none'; }
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#131b24' : LIGHT);
  };
  if (btn) btn.onclick = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (dark) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('lb_theme', dark ? 'light' : 'dark');
    sync();
  };
  sync();
})();

/* ---------- โหลดข้อมูลเริ่มต้น ---------- */
async function boot() {
  $('year').textContent = new Date().getFullYear();
  try {
    const [meRes, svcRes] = await Promise.all([api('/api/me'), api('/api/services')]);
    state.me = meRes.user;
    state.settings = meRes.settings || {};
    state.services = svcRes.services || [];
    applySettings();
    renderAuth();
    renderPlatforms();
    renderCatChips();
    renderHideClosedBtn();
    renderServices();
    renderTopups();
  } catch (e) {
    toast('โหลดข้อมูลไม่สำเร็จ: ' + e.message, 'err');
  }
}

function applySettings() {
  const s = state.settings;
  if (s.siteName) {
    $('siteName').textContent = s.siteName;
    document.title = s.siteName + ' — เพิ่มไลค์ ยอดวิวผู้ติดตาม ราคาถูก ส่งเร็ว';
    document.querySelectorAll('.siteNameTxt').forEach((el) => (el.textContent = s.siteName));
  }
  if (s.tagline) {
    // แถบประกาศวิ่งเต็มแถบตลอดเวลา: คัดลอกข้อความซ้ำให้กว้างกว่าจอ 2 เท่า แล้ววนลูปครึ่ง-ครึ่งแบบไร้รอยต่อ
    const track = document.querySelector('.announce-track');
    if (track) {
      const text = 'ประกาศ: ' + s.tagline;
      const proto = document.createElement('span');
      proto.textContent = text;
      track.replaceChildren(proto);
      const one = Math.max(proto.offsetWidth, 1);
      const perHalf = Math.max(1, Math.ceil((window.innerWidth * 1.15) / one));
      for (let i = 1; i < perHalf * 2; i++) track.appendChild(proto.cloneNode(true));
      // ความเร็วคงที่ราว 55px/วิ ไม่ว่าจอกว้างแค่ไหน
      track.style.animationDuration = Math.max(12, Math.round((one * perHalf) / 55)) + 's';
    }
  }
  if (s.lineContact) $('lineContact').innerHTML = 'ติดต่อแอดมิน: ' + esc(s.lineContact);
  $('statServices').textContent = state.services.length.toLocaleString();
  const s2 = $('statServices2');
  if (s2) s2.textContent = (state.services.length ? Math.floor(state.services.length / 100) * 100 : 0).toLocaleString() + '+';
  renderTopupAmounts();
}

/* ปุ่มยอดลัดหน้าเติมเงิน — แอดมินกำหนดได้จากหน้าตั้งค่า */
function renderTopupAmounts() {
  const amounts = (state.settings.topupAmounts && state.settings.topupAmounts.length)
    ? state.settings.topupAmounts
    : [50, 100, 200, 500, 1000];
  const box = $('amountChips');
  box.innerHTML = amounts.map((n, i) => `<button data-amt="${n}" class="${i === 0 ? 'active' : ''}">${n.toLocaleString()}</button>`).join('');
  state.topupAmount = amounts[0];
  const minT = Number(state.settings.topupMin || 10);
  $('customAmount').min = minT;
  const lbl = $('topupMinLbl');
  if (lbl) lbl.textContent = minT.toLocaleString();
}

/* ---------- Auth ---------- */
function renderAuth() {
  const logged = !!state.me;
  $('authBtn').style.display = logged ? 'none' : '';
  $('logoutBtn').style.display = logged ? '' : 'none';
  $('balanceChip').style.display = logged ? '' : 'none';
  if (logged) $('balanceAmt').textContent = money(state.me.balance);
}

$('authBtn').onclick = () => openModal('authModal');
$('logoutBtn').onclick = async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.reload();
};

$('tabLogin').onclick = () => setAuthMode('login');
$('tabRegister').onclick = () => setAuthMode('register');
function setAuthMode(mode) {
  state.authMode = mode;
  $('tabLogin').classList.toggle('active', mode === 'login');
  $('tabRegister').classList.toggle('active', mode === 'register');
  $('nameField').style.display = mode === 'register' ? '' : 'none';
  $('phoneField').style.display = mode === 'register' ? '' : 'none';
  $('authSubmitBtn').textContent = mode === 'login' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก';
}

$('authSubmitBtn').onclick = async () => {
  const username = $('authUsername').value.trim();
  const password = $('authPassword').value;
  if (!username || !password) return toast('กรอกชื่อผู้ใช้และรหัสผ่านก่อน', 'err');
  const btn = $('authSubmitBtn');
  btn.disabled = true;
  try {
    const path = state.authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const body = { username, password };
    if (state.authMode === 'register') {
      body.name = $('authName').value.trim();
      body.phone = $('authPhone').value.trim();
      const ref = localStorage.getItem('lb_ref');
      if (ref) body.ref = ref;
    }
    const res = await api(path, { method: 'POST', body });
    state.me = res.user;
    closeModal('authModal');
    toast(state.authMode === 'login' ? `ยินดีต้อนรับกลับ ${res.user.name}!` : 'สมัครสมาชิกสำเร็จ! เริ่มเติมเครดิตได้เลย', 'ok');
    renderAuth();
    renderOrders();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
  }
};

/* ---------- หมวดหมู่ + รายการบริการ ---------- */
function platformOf(cat) {
  const s = cat.toLowerCase();
  if (s.includes('instagram')) return 'Instagram';
  if (s.includes('facebook')) return 'Facebook';
  if (s.includes('tiktok')) return 'TikTok';
  if (s.includes('youtube')) return 'YouTube';
  if (s.includes('website') || s.includes('traffic')) return 'Website';
  return 'อื่น ๆ';
}
const PLATFORM_COLORS = {
  Instagram: '#c13584',
  Facebook: '#1877f2',
  TikTok: '#111827',
  YouTube: '#ff0000',
  Website: '#0e7490',
  'อื่น ๆ': '#f4511e',
};
function catTag(name) {
  const p = platformOf(name);
  return { Instagram: 'IG', Facebook: 'FB', TikTok: 'TT', YouTube: 'YT', Website: 'WEB', 'อื่น ๆ': 'อื่นๆ' }[p];
}
/* โลโก้โซเชียลแบบ SVG สีจริง */
const PLATFORM_LOGOS = {
  Instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="ig" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#fdc468"/><stop offset="0.45" stop-color="#df4996"/><stop offset="1" stop-color="#6029a8"/></linearGradient></defs><rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="none" stroke="url(#ig)" stroke-width="2.6"/><circle cx="12" cy="12" r="4.6" fill="none" stroke="url(#ig)" stroke-width="2.6"/><circle cx="17.8" cy="6.2" r="1.5" fill="url(#ig)"/></svg>',
  Facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 21v-7h2.4l.4-3h-2.8V9.2c0-.9.3-1.5 1.6-1.5H16.6V5.1C16.3 5.1 15.4 5 14.4 5c-2.2 0-3.7 1.3-3.7 3.8V11H8.2v3h2.5v7h2.8z" fill="#1877f2"/></svg>',
  TikTok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.6 5.8c.9 1 2.1 1.6 3.4 1.7v2.9c-1.3 0-2.5-.4-3.6-1.1v5.6c0 3.1-2.5 5.6-5.6 5.6S5.2 18 5.2 14.9s2.5-5.6 5.6-5.6c.3 0 .6 0 .9.1v3c-.3-.1-.6-.2-.9-.2-1.5 0-2.7 1.2-2.7 2.7s1.2 2.7 2.7 2.7 2.7-1.2 2.7-2.7V2.8h2.9c0 .1.1 2.1 1.2 3z" fill="#111827"/><path d="M15.4 4.9c.3 1.4 1.3 2.6 2.7 3.1v2.3c-1.3-.1-2.6-.6-3.6-1.4v6c0 2.7-2.2 4.9-4.9 4.9s-4.9-2.2-4.9-4.9 2.2-4.9 4.9-4.9c.3 0 .5 0 .8.1v2.5c-.2-.1-.5-.1-.8-.1-1.4 0-2.5 1.1-2.5 2.5s1.1 2.5 2.5 2.5 2.5-1.1 2.5-2.5V2.5h2.4c-.1.8.2 1.7.9 2.4z" fill="#25f4ee"/><path d="M15 5.6c.4 1.2 1.3 2.1 2.5 2.5v2c-1.2-.1-2.3-.5-3.2-1.2v5.5c0 2.5-2 4.5-4.5 4.5s-4.5-2-4.5-4.5 2-4.5 4.5-4.5c.2 0 .5 0 .7.1v2.3c-.2-.1-.4-.1-.7-.1-1.2 0-2.2 1-2.2 2.2s1 2.2 2.2 2.2 2.2-1 2.2-2.2V2.2h2.3c0 .7.2 1.6 1 2.3z" fill="#fe2c55"/><path d="M17.7 8.3v2c-1.2-.1-2.3-.5-3.2-1.2v5.5c0 2.5-2 4.5-4.5 4.5s-4.5-2-4.5-4.5 2-4.5 4.5-4.5c.2 0 .5 0 .7.1v2.3c-.2-.1-.4-.1-.7-.1-1.2 0-2.2 1-2.2 2.2s1 2.2 2.2 2.2 2.2-1 2.2-2.2V2.2h2.3" fill="#fff"/></svg>',
  YouTube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 7.2c-.2-.9-.9-1.6-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4c-.9.2-1.6.9-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8c.2.9.9 1.6 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4c.9-.2 1.6-.9 1.8-1.8.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8z" fill="#ff0000"/><path d="M10 15.5v-7l6 3.5-6 3.5z" fill="#fff"/></svg>',
  Website: '<svg viewBox="0 0 24 24" fill="none" stroke="#0e7490" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z"/></svg>',
};

/* แท็บแพลตฟอร์ม + ชิปหมวดย่อย */
function renderPlatforms() {
  const visible = activeServices();
  const counts = new Map();
  for (const s of visible) {
    const p = platformOf(s.category);
    counts.set(p, (counts.get(p) || 0) + 1);
  }
  const order = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const tabs = [['all', 'ทั้งหมด', visible.length], ...order.map(([p, n]) => [p, p, n])];
  $('platformTabs').innerHTML = tabs
    .map(
      ([key, label, n]) => {
        const logo = PLATFORM_LOGOS[key];
        return `<button class="ptab ${state.platform === key ? 'active' : ''}" data-p="${esc(key)}">${logo ? `<span class="ptab-logo">${logo}</span>` : ''}${esc(label)}<span class="pcnt">${n}</span></button>`;
      }
    )
    .join('');
  $('platformTabs').querySelectorAll('.ptab').forEach((b) => {
    b.onclick = () => {
      state.platform = b.dataset.p;
      state.cat = 'all';
      state.renderLimit = 60;
      renderPlatforms();
      renderCatChips();
      renderServices();
    };
  });
}

function renderCatChips() {
  const inPlatform = activeServices().filter(
    (s) => state.platform === 'all' || platformOf(s.category) === state.platform
  );
  const counts = new Map();
  for (const s of inPlatform) counts.set(s.category, (counts.get(s.category) || 0) + 1);
  const cats = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const html = [`<button class="chip ${state.cat === 'all' ? 'active' : ''}" data-cat="all">ทุกหมวด</button>`]
    .concat(
      cats.map(
        ([name, n]) =>
          `<button class="chip ${state.cat === name ? 'active' : ''}" data-cat="${esc(name)}" title="${esc(name)}">${esc(name)} <b>${n}</b></button>`
      )
    )
    .join('');
  $('catChips').innerHTML = html;
  $('catChips').querySelectorAll('.chip').forEach((b) => {
    b.onclick = () => {
      state.cat = b.dataset.cat;
      state.renderLimit = 60;
      renderCatChips();
      renderServices();
    };
  });
}

function bindSearch(inputId) {
  const el = $(inputId);
  if (!el) return;
  el.addEventListener('input', (e) => {
    state.search = e.target.value.trim().toLowerCase();
    state.renderLimit = 60;
    // ซิงก์ช่องค้นหาทั้งสองจุดให้เหมือนกัน
    ['searchInput', 'searchInputTop'].forEach((id) => {
      if (id !== inputId && $(id)) $(id).value = e.target.value;
    });
    renderServices();
  });
}
bindSearch('searchInput');
bindSearch('searchInputTop');

function renderHideClosedBtn() {
  const btn = $('hideClosedBtn');
  if (!btn) return;
  const closed = state.services.filter((s) => s.disabled).length;
  btn.className = 'chip' + (state.hideClosed ? ' active' : '');
  btn.innerHTML = state.hideClosed
    ? 'แสดงเฉพาะที่เปิดให้สั่งได้'
    : `แสดงทั้งหมด — รวม ${closed.toLocaleString()} รายการที่ปิดอยู่`;
  btn.onclick = () => {
    state.hideClosed = !state.hideClosed;
    state.renderLimit = 60;
    localStorage.setItem('lb_hideClosed', state.hideClosed ? '1' : '0');
    renderPlatforms();
    renderCatChips();
    renderHideClosedBtn();
    renderServices();
  };
}

function renderServices() {
  const q = state.search;
  const match = (s) => {
    if (state.platform !== 'all' && platformOf(s.category) !== state.platform) return false;
    if (state.cat !== 'all' && s.category !== state.cat) return false;
    if (q && !(s.name + ' ' + s.category).toLowerCase().includes(q)) return false;
    return true;
  };
  const listAll = state.services.filter(match);
  const list = state.hideClosed ? listAll.filter((s) => !s.disabled) : listAll;
  const emptyEl = $('svcEmpty');
  emptyEl.style.display = list.length ? 'none' : '';
  emptyEl.textContent =
    !list.length && listAll.length
      ? 'บริการในหมวดนี้ปิดชั่วคราวจากต้นทางทั้งหมด — ระบบทยอยเปิดกลับเองทุก 1 ชั่วโมง หรือกด "แสดงทั้งหมด" ด้านบนเพื่อดูรายการที่ปิดอยู่'
      : 'ไม่พบบริการที่ค้นหา ลองเปลี่ยนคำหรือเลือกหมวดอื่น';
  const shown = list.slice(0, state.renderLimit);
  $('svcGrid').innerHTML =
    shown
      .map(
        (s) => `
    <div class="svc-card${s.disabled ? ' disabled' : ''}">
      <div class="svc-head">
        <span class="svc-badge svc-badge-logo" data-p="${platformOf(s.category)}">${PLATFORM_LOGOS[platformOf(s.category)] || `<span>${catTag(s.category)}</span>`}</span>
        <span class="svc-cat" title="${esc(s.category)}">${esc(s.category)}</span>
      </div>
      <div class="svc-name" title="${esc(s.name)}">${esc(s.name)}</div>
      <div class="svc-specs">
        <span>ขั้นต่ำ ${Number(s.min).toLocaleString()}</span>
        <span>สูงสุด ${Number(s.max).toLocaleString()}</span>
      </div>
      <div class="svc-foot">
        <div class="svc-price">
          <div class="p">${money(s.rate)} ฿</div>
          <div class="per">ต่อ 1,000 หน่วย</div>
        </div>
        ${/แนะนำ|นิยม|สุดคุ้ม/i.test(s.category + ' ' + s.name) ? '<span class="hit-badge">ขายดี</span>' : ''}
        ${s.disabled
          ? '<span class="off-badge">ยังไม่พร้อมใช้งาน</span>'
          : `<button class="btn btn-primary btn-sm" data-order="${esc(s.id)}">สั่งเลย</button>`}
      </div>
    </div>`
      )
      .join('') +
    (list.length > state.renderLimit
      ? `<button class="btn btn-ghost" id="loadMoreBtn" style="grid-column:1/-1">โหลดเพิ่มอีก ${Math.min(120, list.length - state.renderLimit).toLocaleString()} รายการ (เหลือทั้งหมด ${(list.length - state.renderLimit).toLocaleString()})</button>`
      : '');
  $('svcGrid').querySelectorAll('[data-order]').forEach((b) => {
    b.onclick = () => openOrderModal(b.dataset.order);
  });
  const more = $('loadMoreBtn');
  if (more) more.onclick = () => { state.renderLimit += 120; renderServices(); };
}

/* ---------- Modal สั่งซื้อ ---------- */
let priceTimer = null;
function openOrderModal(id) {
  const s = state.services.find((x) => String(x.id) === String(id));
  if (!s) return;
  state.selectedService = s;
  $('orderSvcName').textContent = s.name;
  $('orderLoginWarn').innerHTML = state.me
    ? ''
    : `<div class="mini-login">ต้องเข้าสู่ระบบก่อนสั่งซื้อ — <a href="#" id="warnLogin" style="color:var(--amber);text-decoration:underline">เข้าสู่ระบบ / สมัคร</a></div>`;
  const warn = $('warnLogin');
  if (warn) warn.onclick = (e) => { e.preventDefault(); closeModal('orderModal'); openModal('authModal'); };
  // บริการผู้ติดตาม Instagram → เด้งปุ่ม "โปรดอ่านก่อน" ให้กดดูรายละเอียด
  const isIgFollow = /instagram/i.test(s.category || '') && /ผู้ติดตาม/.test(s.category || '');
  $('igReadFirstBox').innerHTML = isIgFollow
    ? `<button type="button" class="read-first-btn" id="igReadBtn">โปรดอ่านก่อนเพิ่มผู้ติดตาม Instagram — ดูรายละเอียด</button>`
    : '';
  const rfBtn = $('igReadBtn');
  if (rfBtn) rfBtn.onclick = () => openModal('igReadModal');
  const rfOk = $('igReadOkBtn');
  if (rfOk) rfOk.onclick = () => closeModal('igReadModal');
  $('orderLink').value = '';
  const m = /instagram\.com\/(p|reel)\/|tiktok\.com\/.*\/video\/|facebook\.com\/|fb\.watch/i.test(s.name + s.desc);
  $('orderLinkHint').textContent = m ? 'วางลิงก์โพส/วิดีโอสาธารณะ (ต้องเป็นแบบ Public)' : 'วางลิงก์โพส/โปรไฟล์/วิดีโอที่ต้องการ';
  $('orderQty').min = s.min;
  $('orderQty').max = s.max;
  $('orderQty').value = s.min;
  $('orderQtyHint').textContent = `จำนวน ${Number(s.min).toLocaleString()} - ${Number(s.max).toLocaleString()}`;
  const d = $('orderDesc');
  if (s.desc && s.desc.trim()) { d.style.display = ''; d.textContent = s.desc; } else d.style.display = 'none';
  updateOrderPrice();
  openModal('orderModal');
}

function updateOrderPrice() {
  const s = state.selectedService;
  if (!s) return;
  const qty = Number($('orderQty').value) || 0;
  const raw = (s.rate * qty) / 1000;
  const minOrder = Number(state.settings.minOrderPrice || 0);
  let price;
  if (qty <= 0) {
    price = 0;
  } else if (!minOrder || raw >= minOrder) {
    price = Math.round(raw * 100) / 100;
  } else {
    // โซนออเดอร์เล็ก — ยอดไล่ขึ้นตามจำนวน (ตรงกับสูตรฝั่งเซิร์ฟเวอร์)
    const breakeven = (minOrder / s.rate) * 1000;
    const tapered = minOrder * (0.5 + (0.5 * Math.min(qty, breakeven)) / breakeven);
    price = Math.round(Math.max(raw, tapered) * 100) / 100;
  }
  $('orderPrice').textContent = money(price) + ' ฿';
}

$('orderQty').addEventListener('input', () => {
  clearTimeout(priceTimer);
  priceTimer = setTimeout(updateOrderPrice, 150);
});

$('submitOrderBtn').onclick = async () => {
  const s = state.selectedService;
  if (!s) return;
  const link = $('orderLink').value.trim();
  const qty = Number($('orderQty').value);
  if (!/^https?:\/\//i.test(link)) return toast('กรุณาวางลิงก์ให้ถูกต้อง', 'err');
  if (!Number.isInteger(qty) || qty < s.min || qty > s.max) return toast(`จำนวนต้องอยู่ระหว่าง ${s.min.toLocaleString()} - ${s.max.toLocaleString()}`, 'err');
  const btn = $('submitOrderBtn');
  btn.disabled = true;
  btn.textContent = 'กำลังส่งคำสั่งซื้อ...';
  try {
    const res = await api('/api/order', { method: 'POST', body: { service: s.id, link, quantity: qty } });
    state.me = res.user;
    renderAuth();
    closeModal('orderModal');
    $('doneOrderId').textContent = res.order.id;
    openModal('doneModal');
    renderOrders();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'ยืนยันคำสั่งซื้อ';
  }
};

/* ---------- คำสั่งซื้อของฉัน ---------- */
function statusPill(st) {
  const key = String(st || '').toLowerCase();
  return `<span class="status-pill st-${esc(key)}">${esc(thaiStatus(st))}</span>`;
}
function thaiStatus(st) {
  const map = {
    pending: 'รอดำเนินการ',
    processing: 'กำลังดำเนินการ',
    completed: 'สำเร็จแล้ว',
    partial: 'สำเร็จบางส่วน',
    canceled: 'ยกเลิก',
    refunded: 'คืนเงินแล้ว',
    error: 'ผิดพลาด',
  };
  return map[String(st || '').toLowerCase()] || st || '—';
}

async function renderOrders() {
  const box = $('ordersBox');
  if (!state.me) {
    box.innerHTML = `<div class="empty">เข้าสู่ระบบเพื่อดูคำสั่งซื้อของคุณ</div>`;
    return;
  }
  try {
    const res = await api('/api/orders');
    const list = res.orders;
    if (!list.length) {
      box.innerHTML = `<div class="empty">ยังไม่มีคำสั่งซื้อ — เลือกบริการแล้วกด "สั่งเลย"</div>`;
      return;
    }
    box.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>เลขที่</th><th>รหัสคำสั่งซื้อ</th><th>บริการ</th><th>ลิงก์</th><th>เลขสินค้า</th><th>จำนวน</th><th>ราคา</th><th>สถานะ</th><th>คงเหลือ</th><th>วันที่</th></tr></thead>
      <tbody>${list
        .map(
          (o) => `<tr>
            <td class="mono" data-label="เลขที่">${esc(o.id)}</td>
            <td data-label="รหัสคำสั่งซื้อ">${o.upstreamOrder ? `<span class="code-box code-copy" data-copy="${esc(o.upstreamOrder)}" title="คลิกเพื่อคัดลอก">${esc(o.upstreamOrder)}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
            <td style="max-width:260px" data-label="บริการ">${esc(o.serviceName)}</td>
            <td style="max-width:200px" data-label="ลิงก์">${/^https?:\/\//i.test(o.link || '') ? `<a class="link-box" href="${esc(o.link)}" target="_blank" rel="noopener" title="${esc(o.link)}">${esc(o.link)}</a>` : '<span style="color:var(--muted)">—</span>'}</td>
            <td class="mono" data-label="เลขสินค้า">${esc(o.serviceId ?? '—')}</td>
            <td class="mono" data-label="จำนวน">${Number(o.quantity).toLocaleString()}</td>
            <td class="mono" data-label="ราคา">${money(o.price)} ฿</td>
            <td data-label="สถานะ">${statusPill(o.status)}${o.error ? `<br /><span style="color:var(--red);font-size:.75rem">${esc(o.error)}</span>` : ''}</td>
            <td class="mono" data-label="คงเหลือ">${o.remains != null ? Number(o.remains).toLocaleString() : '—'}</td>
            <td style="white-space:nowrap;color:var(--muted);font-size:.8rem" data-label="วันที่">${dt(o.createdAt)}</td>
          </tr>`
        )
        .join('')}</tbody></table></div>`;
    wireCopy();
  } catch (e) {
    box.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

/* คลิก [data-copy] แล้วคัดลอกค่า + toast */
function wireCopy() {
  document.querySelectorAll('[data-copy]').forEach((el) => {
    if (el._copyWired) return;
    el._copyWired = true;
    el.onclick = () => {
      const v = el.dataset.copy;
      const done = () => toast('คัดลอกแล้ว: ' + v, 'ok');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(v).then(done).catch(() => fallbackCopy(v, done));
      } else fallbackCopy(v, done);
    };
  });
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch {}
  ta.remove();
}
$('refreshOrdersBtn').onclick = () => { renderOrders(); toast('รีเฟรชแล้ว', 'ok'); };

/* ---------- ปุ่มแชทลอย: ระบบเคสติดต่อแอดมิน (ดูประวัติ/แชท/เปิดเคสใหม่) ---------- */
const contact = { view: null, ticketId: null, pollTimer: null };

function contactLineHtml() {
  const lc = (state.settings?.lineContact || '').trim();
  if (!lc) return '';
  const isUrl = /^https?:\/\//i.test(lc);
  return `<a class="btn btn-ghost btn-sm" ${isUrl ? `href="${esc(lc)}" target="_blank" rel="noopener"` : ''} style="width:100%;margin-bottom:12px">ทัก LINE แอดมิน: ${esc(lc)}</a>`;
}

function stopContactPoll() {
  if (contact.pollTimer) { clearInterval(contact.pollTimer); contact.pollTimer = null; }
}
// ขณะเปิดห้องแชทอยู่ ดูข้อความใหม่จากแอดมินทุก 12 วิ
function startContactPoll() {
  stopContactPoll();
  contact.pollTimer = setInterval(async () => {
    if (contact.view !== 'thread') return stopContactPoll();
    try { await renderContactThread(contact.ticketId, true); } catch {}
  }, 12000);
}

async function renderContactHome() {
  stopContactPoll();
  contact.view = 'home';
  const body = $('contactBody');
  if (!state.me) {
    // แจ้งเคสสงวนไว้สำหรับสมาชิกเท่านั้น — แขกต้องสมัคร/ล็อกอินก่อน
    body.innerHTML = `
      <h2>ติดต่อแอดมิน</h2>
      <p class="sub">การแจ้งเคสสงวนไว้สำหรับสมาชิกเท่านั้น — สมัครฟรี ใช้เวลาไม่ถึง 1 นาที</p>
      ${contactLineHtml()}
      <button class="btn btn-primary" id="contactLoginBtn" style="width:100%">เข้าสู่ระบบ / สมัครสมาชิก</button>
      <p class="hint" style="text-align:center;margin-top:10px">สมาชิกติดตามคำตอบและดูประวัติการคุยได้ตลอด</p>`;
    $('contactLoginBtn').onclick = () => {
      closeModal('contactModal');
      openModal('authModal');
    };
    return;
  }
  // สมาชิก: โชว์รายการเคสของตัวเอง
  body.innerHTML = `<h2>ติดต่อแอดมิน</h2><p class="sub">แอดมินตอบกลับเร็ว ทุกวัน 08:00 - 24:00</p>
    <div id="ticketList"><p style="color:var(--muted);font-size:.9rem">กำลังโหลด...</p></div>`;
  const lineHtml = contactLineHtml();
  try {
    const res = await api('/api/contact/tickets');
    const list = res.tickets || [];
    $('ticketList').innerHTML = `
      ${list.length ? list.map((t) => `
        <button class="ticket-item${t.unread ? ' unread' : ''}" data-tid="${esc(t.id)}">
          <span class="ti-top">
            <span class="ti-id mono">${esc(t.id)}</span>
            ${t.topic ? `<span class="ti-topic">${esc(t.topic)}</span>` : ''}
            <span class="ti-status st-${t.status}">${t.status === 'open' ? 'เปิดอยู่' : 'ปิดแล้ว'}</span>
          </span>
          <span class="ti-msg">${t.productCode ? '[' + esc(t.productCode) + '] ' : ''}${esc((t.last?.text || '').slice(0, 70))}${(t.last?.text || '').length > 70 ? '…' : ''}</span>
          <span class="ti-meta">${t.last?.from === 'admin' ? 'แอดมิน' : 'คุณ'} · ${dt(t.updatedAt)} · ${t.count} ข้อความ${t.unread ? ' · <b style="color:var(--brand)">มีข้อความใหม่</b>' : ''}</span>
        </button>`).join('') : '<div class="empty" style="padding:18px">ยังไม่มีประวัติการคุย — กดปุ่มด้านล่างเพื่อเปิดเคสแรกของคุณ</div>'}
      ${lineHtml}
      <button class="btn btn-primary" id="contactNewBtn" style="width:100%;margin-top:12px">เปิดเคสใหม่</button>`;
    $('ticketList').querySelectorAll('[data-tid]').forEach((b) => {
      b.onclick = () => renderContactThread(b.dataset.tid);
    });
    $('contactNewBtn').onclick = renderContactForm;
  } catch (e) {
    $('ticketList').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

function renderContactForm() {
  stopContactPoll();
  contact.view = 'form';
  $('contactBody').innerHTML = `
    <h2>เปิดเคสใหม่</h2>
    <p class="sub">เลือกเรื่องที่แจ้ง แล้วเล่าปัญหาของคุณ แอดมินจะตอบกลับในห้องแชทนี้</p>
    <div class="form-section">เรื่อง</div>
    <div class="topic-chips" id="contactTopicChips">
      <button type="button" class="topic-chip active" data-topic="order">คำสั่งซื้อ</button>
      <button type="button" class="topic-chip" data-topic="payment">การชำระเงิน</button>
      <button type="button" class="topic-chip" data-topic="other">อื่นๆ</button>
    </div>
    <input type="hidden" id="contactTopic" value="order" />
    <div class="form-section">ปัญหาที่พบ</div>
    <div class="field">
      <label>อาการปัญหา *</label>
      <select id="contactIssue">
        <option value="" disabled selected>— เลือกอาการ —</option>
        <option value="อาการเริ่มต้น">อาการเริ่มต้น</option>
        <option value="ยอดนับถอยหลังไม่ขยับ">ยอดนับถอยหลังไม่ขยับ</option>
        <option value="ยอดลดลง (เข้าแล้วหาย)">ยอดลดลง (เข้าแล้วหาย)</option>
        <option value="ทำงานเสร็จแล้ว แต่ยอดไม่ตรงตามจำนวนที่สั่ง">ทำงานเสร็จแล้ว แต่ยอดไม่ตรงตามจำนวนที่สั่ง</option>
        <option value="ทำงานไม่ได้ / ผิดพลาด">ทำงานไม่ได้ / ผิดพลาด</option>
        <option value="สอบถามเรื่องอื่น ๆ">สอบถามเรื่องอื่น ๆ</option>
      </select>
    </div>
    <div class="field">
      <label>รหัสคำสั่งซื้อ</label>
      <input type="text" id="contactProduct" maxlength="60" placeholder="เช่น 6964836 — ก๊อปจากกล่องส้มในหน้าคำสั่งซื้อของฉัน" />
    </div>
    <div class="field">
      <label>ข้อความถึงแอดมิน *</label>
      <textarea id="contactMsg" rows="4" maxlength="2000" placeholder="เล่าอาการ เช่น สั่งแล้ว 2 ชม. ยอดยังไม่ขยับ ช่วยตรวจสอบให้หน่อยครับ"></textarea>
    </div>
    <button class="btn btn-primary" id="contactSendBtn" style="width:100%;margin-top:6px">สร้างเคสและส่งข้อความ</button>
    <button class="btn btn-ghost" id="contactBackBtn" style="width:100%;margin-top:8px">กลับไปหน้ารายการ</button>`;
  $('contactSendBtn').onclick = contactSendNew;
  $('contactBackBtn').onclick = renderContactHome;
  $('contactTopicChips').querySelectorAll('.topic-chip').forEach((chip) => {
    chip.onclick = () => {
      $('contactTopicChips').querySelectorAll('.topic-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      $('contactTopic').value = chip.dataset.topic;
    };
  });
}

async function contactSendNew() {
  const btn = $('contactSendBtn');
  const message = $('contactMsg').value.trim();
  if (message.length < 3) return toast('พิมพ์ข้อความอย่างน้อย 3 ตัวอักษร', 'err');
  const topicSel = $('contactTopic');
  const issueSel = $('contactIssue');
  const prodEl = $('contactProduct');
  const backEl = $('contactBack');
  if (issueSel && !issueSel.value) return toast('กรุณาเลือกอาการปัญหาก่อนส่ง', 'err');
  btn.disabled = true;
  btn.textContent = 'กำลังส่ง...';
  try {
    const res = await api('/api/contact', {
      method: 'POST',
      body: {
        message,
        topic: topicSel ? topicSel.value : '',
        issueType: issueSel ? issueSel.value : '',
        productCode: prodEl ? prodEl.value.trim() : '',
        contact: backEl ? backEl.value.trim() : '',
      },
    });
    toast('ส่งแล้ว! แอดมินจะตอบกลับในห้องแชทเร็ว ๆ นี้', 'ok');
    if (res.ticketId && state.me) await renderContactThread(res.ticketId);
    else closeModal('contactModal');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'สร้างเคสและส่งข้อความ';
  }
}

function bubble(m) {
  const mine = m.from === 'customer';
  return `<div class="chat-bubble ${mine ? 'me' : 'admin'}">
    <div class="cb-text">${esc(m.text)}</div>
    <div class="cb-time">${dt(m.at)}</div>
  </div>`;
}

async function renderContactThread(ticketId, silent) {
  try {
    const res = await api('/api/contact/thread?id=' + encodeURIComponent(ticketId));
    const t = res.ticket;
    contact.view = 'thread';
    contact.ticketId = ticketId;
    const closed = t.status === 'closed';
    $('contactBody').innerHTML = `
      <h2>เคส ${esc(t.id)} ${closed ? '<span class="ti-status st-closed">ปิดแล้ว</span>' : '<span class="ti-status st-open">เปิดอยู่</span>'}</h2>
      <p class="sub">ประวัติการคุยทั้งหมดของเคสนี้</p>
      <div class="chat-scroll">${t.messages.map(bubble).join('')}</div>
      ${closed
        ? `<div class="chat-closed-note">เคสนี้ปิดแล้ว (คุยจบเรียบร้อย) — มีเรื่องใหม่แจ้งได้ที่ "เปิดเคสใหม่"</div>
           <button class="btn btn-ghost" id="contactBackBtn" style="width:100%;margin-top:10px">กลับไปหน้ารายการ</button>`
        : `<div class="chat-reply-row">
             <textarea id="chatReply" rows="2" maxlength="2000" placeholder="พิมพ์ข้อความตอบกลับ..."></textarea>
             <button class="btn btn-primary" id="chatSendBtn">ส่ง</button>
           </div>
           <button class="btn btn-ghost btn-sm" id="contactBackBtn" style="width:100%;margin-top:8px">กลับไปหน้ารายการ</button>`}`;
    const scroll = document.querySelector('#contactModal .chat-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
    const sendBtn = $('chatSendBtn');
    if (sendBtn) {
      sendBtn.onclick = async () => {
        const text = $('chatReply').value.trim();
        if (!text) return;
        sendBtn.disabled = true;
        try {
          await api('/api/contact/reply', { method: 'POST', body: { ticketId, text } });
          await renderContactThread(ticketId, true);
        } catch (e) {
          toast(e.message, 'err');
        } finally {
          sendBtn.disabled = false;
        }
      };
    }
    const backBtn = $('contactBackBtn');
    if (backBtn) backBtn.onclick = renderContactHome;
    startContactPoll();
  } catch (e) {
    if (!silent) toast(e.message, 'err');
  }
}

$('contactFab').onclick = () => { openModal('contactModal'); renderContactHome(); };
// แบนเนอร์ "โปรดอ่านก่อน" บนหน้าแรก — กดแล้ว popup รายละเอียดเด้งขึ้นทันที
$('igReadHomeBtn').onclick = () => openModal('igReadModal');
$('igReadOkBtn').onclick = () => closeModal('igReadModal');
// ปิดหน้าต่าง = หยุดดึงข้อความใหม่
document.querySelector('#contactModal.modal-backdrop').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) stopContactPoll();
});
document.querySelectorAll('[data-close="contactModal"]').forEach((b) => b.addEventListener('click', stopContactPoll));

/* ---------- เติมเงิน ---------- */
$('amountChips').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-amt]');
  if (!b) return;
  $('amountChips').querySelectorAll('button').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  state.topupAmount = Number(b.dataset.amt);
  $('customAmount').value = '';
});
$('customAmount').addEventListener('input', (e) => {
  $('amountChips').querySelectorAll('button').forEach((x) => x.classList.remove('active'));
  state.topupAmount = Number(e.target.value) || 0;
});

// --- สลิป: เลือกไฟล์ / ลากวาง / พรีวิว ---
let slipDataUrl = null;
function setSlip(file) {
  if (!file) return;
  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) return toast('รับเฉพาะรูป PNG / JPG / WEBP / GIF', 'err');
  if (file.size > 3 * 1024 * 1024) return toast('รูปใหญ่เกินไป (สูงสุด ~3MB) ลองครอบเฉพาะส่วนสลิป', 'err');
  const reader = new FileReader();
  reader.onload = () => {
    slipDataUrl = reader.result;
    $('slipPreviewImg').src = slipDataUrl;
    $('slipPreview').style.display = '';
    $('slipHint').textContent = 'แนบรูปแล้ว: ' + file.name;
  };
  reader.readAsDataURL(file);
}
$('slipPickBtn').onclick = () => $('slipFile').click();
$('slipFile').addEventListener('change', (e) => setSlip(e.target.files[0]));
$('slipRemoveBtn').onclick = () => {
  slipDataUrl = null;
  $('slipFile').value = '';
  $('slipPreview').style.display = 'none';
  $('slipHint').textContent = 'PNG / JPG ไม่เกิน ~3MB';
};
['dragover', 'dragleave', 'drop'].forEach((ev) => {
  $('slipDrop').addEventListener(ev, (e) => {
    e.preventDefault();
    $('slipDrop').classList.toggle('drag', ev === 'dragover');
    if (ev === 'drop') setSlip(e.dataTransfer.files[0]);
  });
});

$('genQrBtn').onclick = async () => {
  const amount = state.topupAmount;
  const minT = Number(state.settings.topupMin || 10);
  if (!amount || amount < minT) return toast(`ยอดเติมขั้นต่ำ ${minT.toLocaleString()} บาท`, 'err');
  if (!state.me) { openModal('authModal'); return toast('เข้าสู่ระบบก่อนเติมเงิน', 'err'); }
  const btn = $('genQrBtn');
  btn.disabled = true;
  try {
    const res = await api('/api/topup', { method: 'POST', body: { amount, ref: $('slipRef').value.trim() } });
    state.pendingTopup = res.topup;
    $('qrTarget').innerHTML = '';
    if (window.QRCode) {
      new QRCode($('qrTarget'), { text: res.qr, width: 230, height: 230, correctLevel: QRCode.CorrectLevel.M });
      $('qrArea').style.display = '';
    } else {
      toast('ระบบ QR ยังไม่พร้อม กรุณาติดต่อแอดมิน', 'err');
    }
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
  }
};

$('confirmTopupBtn').onclick = async () => {
  if (!state.pendingTopup) return toast('สร้าง QR ก่อนแจ้งชำระเงิน', 'err');
  const btn = $('confirmTopupBtn');
  btn.disabled = true;
  btn.textContent = 'กำลังส่งข้อมูล...';
  try {
    await api('/api/topup-confirm', {
      method: 'POST',
      body: { id: state.pendingTopup.id, ref: $('slipRef').value.trim(), slip: slipDataUrl },
    });
    toast(slipDataUrl ? 'แจ้งชำระเงินพร้อมสลิปเรียบร้อย รอแอดมินตรวจสอบ' : 'แจ้งชำระเงินเรียบร้อย รอแอดมินอนุมัติ', 'ok');
    $('qrArea').style.display = 'none';
    state.pendingTopup = null;
    slipDataUrl = null;
    $('slipFile').value = '';
    $('slipPreview').style.display = 'none';
    $('slipHint').textContent = 'PNG / JPG ไม่เกิน ~3MB';
    renderTopups();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'แจ้งชำระเงินแล้ว';
  }
};

async function renderTopups() {
  if (!state.me) {
    $('topupList').innerHTML = `<div class="empty" style="padding:20px">เข้าสู่ระบบเพื่อดูประวัติ</div>`;
    return;
  }
  try {
    const res = await api('/api/topups');
    const list = res.topups;
    if (!list.length) {
      $('topupList').innerHTML = `<div class="empty" style="padding:20px">ยังไม่มีประวัติการเติมเงิน</div>`;
      return;
    }
    $('topupList').innerHTML = `<div class="table-wrap"><table style="min-width:0">
      <thead><tr><th>รหัส</th><th>ยอด</th><th>สถานะ</th><th>วันที่</th></tr></thead>
      <tbody>${list
        .map(
          (t) => `<tr>
            <td class="mono">${esc(t.id)}</td>
            <td class="mono">${money(t.amount)} ฿</td>
            <td><span class="status-pill st-${esc(t.status)}">${t.status === 'pending' ? 'รออนุมัติ' : t.status === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธ'}</span></td>
            <td style="white-space:nowrap;color:var(--muted);font-size:.8rem">${dt(t.createdAt)}</td>
          </tr>`
        )
        .join('')}</tbody></table></div>`;
  } catch (e) {
    $('topupList').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

/* ---------- โปรไฟล์ของฉัน ---------- */
async function renderProfile() {
  if (!state.me) {
    $('profileInfo').innerHTML = `<div class="empty" style="padding:30px">เข้าสู่ระบบเพื่อดูโปรไฟล์</div>`;
    $('profileStats').innerHTML = '';
    const hero = document.querySelector('.pf-hero');
    if (hero) hero.style.display = 'none';
    return;
  }
  try {
    const res = await api('/api/profile');
    const u = res.user;
    const s = res.stats;
    // การ์ดฮีโร่: อวตาร + ชื่อ + เครดิตเด่น
    const hero = document.querySelector('.pf-hero');
    if (hero) hero.style.display = '';
    const av = $('pfAvatar');
    if (av) av.textContent = (u.name || u.username || '?').trim().charAt(0).toUpperCase();
    const dn = $('pfDisplayName'); if (dn) dn.textContent = u.name || u.username;
    const pu = $('pfUid'); if (pu) pu.textContent = u.uid || '';
    const pun = $('pfUsername'); if (pun) pun.textContent = '@' + u.username;
    const pb = $('pfBalance'); if (pb) pb.textContent = money(u.balance);
    $('profileInfo').innerHTML = `
      <div class="info-row"><span class="k">รหัสสมาชิก</span><span class="v mono" style="color:var(--brand);font-weight:600">${esc(u.uid || '—')}</span></div>
      <div class="info-row"><span class="k">เบอร์โทร</span><span class="v mono">${esc(u.phone || '—')}</span></div>
      <div class="info-row"><span class="k">ชื่อผู้ใช้</span><span class="v mono">${esc(u.username)}</span></div>
      <div class="info-row"><span class="k">ชื่อแสดง</span><span class="v">${esc(u.name)}</span></div>
      <div class="info-row"><span class="k">เครดิตคงเหลือ</span><span class="v" style="color:var(--money)">${money(u.balance)} ฿</span></div>
      <div class="info-row"><span class="k">สมาชิกเมื่อ</span><span class="v">${dt(u.createdAt)}</span></div>`;
    $('profileStats').innerHTML = `
      <div class="pf-stat"><div class="num">${s.totalOrders}</div><div class="lbl2">ออเดอร์ทั้งหมด</div></div>
      <div class="pf-stat green"><div class="num">${s.completed}</div><div class="lbl2">สำเร็จแล้ว</div></div>
      <div class="pf-stat cyan"><div class="num">${s.processing}</div><div class="lbl2">กำลังดำเนินการ</div></div>
      <div class="pf-stat pink"><div class="num">${money(s.spent)}฿</div><div class="lbl2">ใช้ไปทั้งหมด</div></div>
      <div class="pf-stat amber"><div class="num">${money(s.topupTotal)}฿</div><div class="lbl2">เติมเงินมาแล้ว</div></div>
      <div class="pf-stat"><div class="num">${s.topupCount}</div><div class="lbl2">ครั้งที่เติม</div></div>`;
    $('profileName').value = u.name || '';
    $('profilePhone').value = u.phone || '';
    renderReferral();
  } catch (e) {
    $('profileInfo').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

$('saveNameBtn').onclick = async () => {
  try {
    const res = await api('/api/profile', { method: 'POST', body: { name: $('profileName').value.trim(), phone: $('profilePhone').value.trim() } });
    state.me = res.user;
    renderAuth();
    toast('บันทึกข้อมูลเรียบร้อย', 'ok');
    renderProfile();
  } catch (e) {
    toast(e.message, 'err');
  }
};

$('changePwBtn').onclick = async () => {
  const newPw = $('newPw').value;
  if (newPw.length < 4) return toast('รหัสผ่านใหม่ต้องยาวอย่างน้อย 4 ตัวอักษร', 'err');
  if (newPw !== $('newPw2').value) return toast('ยืนยันรหัสผ่านใหม่ไม่ตรงกัน', 'err');
  try {
    await api('/api/profile', { method: 'POST', body: { oldPassword: $('oldPw').value, newPassword: newPw } });
    $('oldPw').value = $('newPw').value = $('newPw2').value = '';
    toast('เปลี่ยนรหัสผ่านสำเร็จ', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  }
};

/* ---------- Modal helpers ---------- */
function openModal(id) { $(id).classList.add('show'); }
function closeModal(id) { $(id).classList.remove('show'); }
window.closeModal = closeModal;
document.querySelectorAll('.modal-backdrop').forEach((bd) => {
  bd.addEventListener('click', (e) => { if (e.target === bd) bd.classList.remove('show'); });
});
document.querySelectorAll('[data-close]').forEach((b) => {
  b.onclick = () => closeModal(b.dataset.close);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop.show').forEach((m) => m.classList.remove('show'));
});

/* ---------- routing ด้วย hash ---------- */
function route() {
  const h = (location.hash || '#home').slice(1);
  const view = ['home', 'orders', 'topup', 'profile'].includes(h) ? h : 'home';
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === view));
  if (view === 'orders') renderOrders();
  if (view === 'topup') renderTopups();
  if (view === 'profile') renderProfile();
}
window.addEventListener('hashchange', route);


/* ---------- เฝ้าดูการอัปเดทระบบ: โค้ดเปลี่ยนก็รีเฟรชหน้าเอง (แต่ไม่รีเซ็ตตอนกรอกฟอร์ม) ---------- */
let sysFp = null;
function userIsBusy() {
  const el = document.activeElement;
  const typing = el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && el.type !== 'checkbox';
  const modalOpen = !!document.querySelector('.modal-backdrop.show');
  return typing || modalOpen;
}
setInterval(async () => {
  try {
    const r = await fetch('/api/ping', { cache: 'no-store' });
    if (!r.ok) return;
    const d = await r.json();
    if (sysFp === null) { sysFp = d.fp; return; }
    if (d.fp !== sysFp) {
      if (userIsBusy()) return; // รอรอบหน้า ให้ผู้ใช้พิมพ์จบก่อน
      try {
        toast('ระบบได้รับการอัปเดต กำลังโหลดหน้าใหม่อัตโนมัติ', 'ok');
      } catch {}
      setTimeout(() => location.reload(), 1500);
    }
  } catch { /* เซิร์ฟเวอร์ออฟไลน์ชั่วครู่ — ไม่ต้องทำอะไร */ }
}, 8000);

/* ---------- ดึงสถานะออเดอร์ใหม่อัตโนมัติทุก 45 วิ ----------
   ลูกค้าเปิดหน้าค้างไว้ก็เห็น "สำเร็จแล้ว" เองโดยไม่ต้องรีเฟรช
   (ฝั่งเซิร์ฟเวอร์คุมการยิงไปต้นทางไว้ 90 วิต่อรายการ ไม่หนัก API) */
setInterval(() => {
  if (!state.me || userIsBusy()) return;
  if ((location.hash || '#home') === '#orders') renderOrders();
}, 45000);

/* ---------- ระฆังแจ้งเตือน: ประกาศจากแอดมิน + คำตอบแอดมินในเคสของฉัน ---------- */
let bellAnns = [];
let bellTickets = []; // เคสของฉันที่แอดมินตอบกลับแล้วยังไม่ได้อ่าน
let lastKnownUnread = { ann: 0, ticket: 0 };

async function fetchBellAnnounces() {
  try {
    const jobs = [fetch('/api/announces', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { announces: [] }))];
    if (state.me) jobs.push(api('/api/contact/tickets').catch(() => ({ tickets: [] })));
    const [annRes, tktRes] = await Promise.all(jobs);
    bellAnns = annRes.announces || [];
    bellTickets = tktRes ? tktRes.tickets || [] : [];
    updateBellBadge(true);
  } catch { /* ออฟไลน์ชั่วครู่ ไม่เป็นไร */ }
}
function bellUnreadCounts() {
  const seenAt = Number(localStorage.getItem('lb_notice_seen') || 0);
  return {
    ann: bellAnns.filter((a) => a.at > seenAt).length,
    ticket: bellTickets.filter((t) => t.unread).length,
  };
}
function updateBellBadge(fromPoll) {
  const el = $('bellBadge');
  if (!el) return;
  const c = bellUnreadCounts();
  const total = c.ann + c.ticket;
  if (total > 0) {
    el.textContent = total > 9 ? '9+' : total;
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
  // ตอนโหลดหน้าครั้งแรกไม่เด้ง toast — เด้งเฉพาะที่ "เพิ่มขึ้น" ระหว่างใช้งาน
  if (fromPoll && c.ticket > lastKnownUnread.ticket) {
    toast('แอดมินตอบกลับเคสของคุณแล้ว — กดระฆังเพื่ออ่าน', 'ok');
  }
  if (fromPoll && c.ann > lastKnownUnread.ann) {
    toast('มีประกาศใหม่จากร้าน', 'ok');
  }
  lastKnownUnread = c;
}
$('bellBtn').onclick = async (e) => {
  e.stopPropagation();
  const panel = $('bellPanel');
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  await fetchBellAnnounces();
  const body = $('bellBody');
  const seenAt = Number(localStorage.getItem('lb_notice_seen') || 0);
  const items = [
    ...bellTickets
      .filter((t) => t.unread)
      .map((t) => ({
        type: 'ticket',
        id: t.id,
        text: 'แอดมินตอบกลับเคส ' + t.id + ': ' + (t.last?.from === 'admin' ? t.last.text.slice(0, 60) : ''),
        at: t.updatedAt,
        isNew: true,
      })),
    ...bellAnns.map((a) => ({ type: 'ann', id: a.id, text: a.text, at: a.at, isNew: a.at > seenAt, important: !!a.important })),
  ].sort((a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0) || b.at - a.at);
  if (!items.length) {
    body.innerHTML = `<div class="empty" style="padding:18px">ยังไม่มีการแจ้งเตือน — ประกาศจากร้านและคำตอบจากแอดมินจะโผล่ที่นี่</div>`;
  } else {
    body.innerHTML = items
      .map((it) => `
        <div class="notice-item${it.type === 'ticket' ? ' notice-ticket' : ''}${it.important ? ' notice-imp' : ''}" data-nid="${esc(it.id)}" data-ntype="${it.type}" ${it.type === 'ticket' ? 'style="cursor:pointer"' : ''}>
          <div class="notice-meta">
            <span class="notice-kind ${it.type === 'ticket' ? 'k-ticket' : 'k-ann'}">${it.type === 'ticket' ? 'แชท' : 'ประกาศ'}</span>
            ${it.important ? '<span class="notice-imp-tag">สำคัญ</span>' : ''}
            ${it.isNew ? '<span class="notice-new">ใหม่</span>' : ''}
            <span class="notice-when">${dt(it.at)}</span>
          </div>
          <div class="notice-text">${esc(it.text)}</div>
        </div>`)
      .join('');
    // กดรายการเคส = เปิดห้องแชทนั้นทันที (ตรง ๆ ไม่ผ่านหน้ารายการ กันแข่งกันโหลด)
    body.querySelectorAll('[data-ntype="ticket"]').forEach((el2) => {
      el2.onclick = async () => {
        $('bellPanel').style.display = 'none';
        openModal('contactModal');
        await renderContactThread(el2.dataset.nid);
      };
    });
    const newestAnn = bellAnns[0];
    if (newestAnn) localStorage.setItem('lb_notice_seen', String(Math.max(seenAt, newestAnn.at)));
    updateBellBadge();
  }
  panel.style.display = '';
};
$('bellPanelClose').onclick = () => { $('bellPanel').style.display = 'none'; };
// คลิกข้างนอกแผง = ปิด
document.addEventListener('click', (e) => {
  const panel = $('bellPanel');
  if (panel.style.display === 'none') return;
  if (!panel.contains(e.target) && e.target !== $('bellBtn') && !$('bellBtn').contains(e.target)) {
    panel.style.display = 'none';
  }
});
fetchBellAnnounces();
setInterval(fetchBellAnnounces, 30_000); // ตรวจข่าวใหม่+คำตอบแอดมินทุก 30 วิ จุดแดงเด้งเอง

boot();
route(); // สลับหน้าให้ถูกต้องกรณีเปิดเว็บมาพร้อม hash (เช่น จาก bookmark)

/* ---------- ระบบแนะนำเพื่อน รับเครดิตฟรี ---------- */
let refData = null;
async function renderReferral() {
  const box = $('referralBox');
  if (!box) return;
  box.innerHTML = '<p style="color:var(--muted);font-size:.85rem">กำลังโหลด...</p>';
  try {
    const res = await api('/api/referral');
    refData = res;
    box.innerHTML = `
      <button type="button" class="ref-btn" id="refOpenBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>
        <span><b>แนะนำเพื่อน รับเครดิตฟรี</b><br /><span style="font-weight:400;font-size:.78rem">เพื่อนเติมเงินแรก ≥ ${res.minTopup}฿ คุณได้ ${res.rewardPerFriend}฿ — รับไปแล้ว ${res.earned}฿</span></span>
      </button>`;
    $('refOpenBtn').onclick = openReferralModal;
  } catch (e) {
    box.innerHTML = '';
  }
}
async function openReferralModal() {
  openModal('refModal');
  const body = $('refBody');
  if (!refData) { body.innerHTML = '<p>กำลังโหลด...</p>'; return; }
  const url = location.origin + '/' + refData.link;
  body.innerHTML = `
    <div class="ref-stats">
      <div><b>${refData.invited}</b><span>เพื่อนสมัครแล้ว</span></div>
      <div><b>${refData.qualified}</b><span>ผ่านเกณฑ์รับรางวัล</span></div>
      <div><b>${refData.earned}฿</b><span>เครดิตที่ได้รับ</span></div>
    </div>
    <div class="form-section">ลิงก์ของคุณ</div>
    <div class="ref-link-row">
      <span class="mono" id="refLinkTxt">${esc(url)}</span>
      <button class="btn btn-primary btn-sm" id="refCopyBtn">คัดลอก</button>
    </div>
    <div class="form-section">เงื่อนไข (อ่านก่อนแชร์)</div>
    <div class="rf-item" style="font-size:.84rem">• เพื่อนต้องสมัครผ่านลิงก์นี้ และ<strong>เติมเงินครั้งแรก ≥ ${refData.minTopup} บาท</strong> เท่านั้น คุณจึงจะได้รางวัล</div>
    <div class="rf-item" style="font-size:.84rem">• รางวัล <strong>${refData.rewardPerFriend} บาทต่อ 1 เพื่อน</strong> สูงสุด ${refData.maxFriends} เพื่อน (รวมไม่เกิน ${refData.rewardPerFriend * refData.maxFriends} บาทต่อบัญชี)</div>
    <div class="rf-item" style="font-size:.84rem">• เครดิตเข้าบัญชีอัตโนมัติทันทีที่แอดมินอนุมัติการเติมเงินของเพื่อน</div>`;
  $('refCopyBtn').onclick = () => {
    const done = () => toast('คัดลอกลิงก์แนะนำแล้ว', 'ok');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done).catch(() => {});
    else done();
  };
}
