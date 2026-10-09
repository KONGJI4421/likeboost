/* ===== LikeBoost — หน้าแอดมิน ===== */
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (ts) => (ts ? new Date(ts).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({ error: 'ระบบผิดพลาด' }));
  if (res.status === 403 && path.startsWith('/api/admin')) showLogin();
  if (!res.ok) throw new Error(json.error || 'เกิดข้อผิดพลาด');
  return json;
}

function showLogin() {
  $('adminLogin').style.display = '';
  $('adminApp').style.display = 'none';
}
function showApp() {
  $('adminLogin').style.display = 'none';
  $('adminApp').style.display = '';
  loadAll();
}

$('adminLoginBtn').onclick = async () => {
  try {
    await api('/api/admin/login', { method: 'POST', body: { password: $('adminPw').value } });
    showApp();
  } catch (e) {
    toast(e.message, 'err');
  }
};
$('adminPw').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('adminLoginBtn').click();
});
$('adminLogoutBtn').onclick = async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  location.reload();
};

/* ---------- tabs ---------- */
document.querySelectorAll('.admin-tabs button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.admin-tabs button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'overview') loadOverview();
    if (b.dataset.tab === 'settings') loadSettings(); // ดึงค่าล่าสุดทุกครั้ง กันตัวเลขเก่าค้างจากการแก้ไขครั้งก่อน
    if (b.dataset.tab === 'topups') loadTopups();
    if (b.dataset.tab === 'orders') loadOrders(false);
    if (b.dataset.tab === 'contact') { loadMessages(); loadAnnounces(); }
  };
});

/* ---------- ประกาศถึงลูกค้า ---------- */
async function loadAnnounces() {
  try {
    const res = await api('/api/announces');
    const list = res.announces || [];
    const box = $('announceList');
    if (!box) return;
    if (!list.length) {
      box.innerHTML = `<p style="color:var(--muted);font-size:.84rem">ยังไม่มีประกาศ — โพสต์ข้อความแรกของคุณด้านบน</p>`;
      return;
    }
    // ประกาศสำคัญเรียงบนสุดก่อนเสมอ
    const sorted = [...list].sort((a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0) || b.at - a.at);
    box.innerHTML = sorted
      .map((a) => `<div class="msg-card ${a.important ? 'ann-important' : ''}" style="margin-bottom:8px;padding:12px 14px" data-ann="${esc(a.id)}">
        <div class="ann-meta">
          <span class="ann-time">${dt(a.at)}</span>
          ${a.important ? '<span class="ann-imp-tag">สำคัญ</span>' : ''}
        </div>
        <div class="msg-body" style="font-size:.9rem">${esc(a.text)}${a.editedAt ? ' <span style="color:var(--muted);font-size:.7rem">(แก้ไขแล้ว)</span>' : ''}</div>
        <div class="ann-btn-row">
          <button class="btn btn-ghost btn-sm" data-anedit="${esc(a.id)}">แก้ไข</button>
          <button class="btn btn-ghost btn-sm" data-imp="${esc(a.id)}">${a.important ? '★ เลิกปักหมุด' : '☆ ปักหมุด'}</button>
          <button class="btn btn-danger btn-sm" data-andel="${esc(a.id)}">ลบ</button>
        </div>
      </div>`)
      .join('');
    box.querySelectorAll('[data-imp]').forEach((b) => {
      b.onclick = async () => {
        await api('/api/admin/announce-toggle-important', { method: 'POST', body: { id: b.dataset.imp } });
        loadAnnounces();
      };
    });
    box.querySelectorAll('[data-andel]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('ลบประกาศนี้?')) return;
        await api('/api/admin/announce-delete', { method: 'POST', body: { id: b.dataset.andel } });
        loadAnnounces();
      };
    });
    // แก้ไขประกาศ: เปลี่ยนข้อความเป็นช่อง input + บันทึก/ยกเลิก
    box.querySelectorAll('[data-anedit]').forEach((b) => {
      b.onclick = () => {
        const card = b.closest('[data-ann]');
        const body = card.querySelector('.msg-body');
        const oldText = body.textContent.replace(/ \(แก้ไขแล้ว\)$/, '').trim();
        const isImp = card.classList.contains('ann-important');
        body.innerHTML = `
          <textarea class="ann-edit-box" rows="2" maxlength="500">${esc(oldText)}</textarea>
          <label class="imp-toggle" style="margin-top:8px"><input type="checkbox" data-animp ${isImp ? 'checked' : ''} /> ประกาศสำคัญ</label>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn btn-primary btn-sm" data-ansave>บันทึก</button>
            <button class="btn btn-ghost btn-sm" data-ancancel>ยกเลิก</button>
          </div>`;
        card.querySelector('[data-ansave]').onclick = async () => {
          const text = card.querySelector('.ann-edit-box').value.trim();
          if (text.length < 2) return toast('พิมพ์ข้อความอย่างน้อย 2 ตัวอักษร', 'err');
          try {
            await api('/api/admin/announce-edit', { method: 'POST', body: { id: card.dataset.ann, text, important: card.querySelector('[data-animp]').checked } });
            toast('แก้ไขประกาศแล้ว — ลูกค้าเห็นเวอร์ชันใหม่ทันที', 'ok');
            loadAnnounces();
          } catch (e) { toast(e.message, 'err'); }
        };
        card.querySelector('[data-ancancel]').onclick = () => loadAnnounces();
      };
    });
  } catch (e) {
    const box = $('announceList');
    if (box) box.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}
$('announcePostBtn').onclick = async () => {
  const ta = $('announceText');
  const text = ta.value.trim();
  if (text.length < 2) return toast('พิมพ์ข้อความก่อนโพสต์', 'err');
  const btn = $('announcePostBtn');
  btn.disabled = true;
  try {
    await api('/api/admin/announce', { method: 'POST', body: { text, important: $('announceImportant').checked } });
    ta.value = '';
    toast('โพสต์ประกาศแล้ว — ลูกค้าเห็นบนหน้าคำสั่งซื้อทันที', 'ok');
    loadAnnounces();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
  }
};

/* ---------- เคสติดต่อจากลูกค้า (แชทสองทาง + ปิดเคส) ---------- */
function updateContactBadge(unread) {
  const el = $('contactBadge');
  if (!el) return;
  if (unread > 0) { el.textContent = unread > 99 ? '99+' : unread; el.style.display = ''; }
  else el.style.display = 'none';
}
async function loadMessages() {
  try {
    const res = await api('/api/admin/messages');
    const list = res.messages || [];
    updateContactBadge(res.unread || 0);
    if (!list.length) {
      $('messagesBox').innerHTML = `<div class="empty">ยังไม่มีเคสจากลูกค้า — เมื่อลูกค้ากดปุ่มแชทที่หน้าเว็บ เคสจะโผล่ที่นี่ทันที</div>`;
      return;
    }
    $('messagesBox').innerHTML = list
      .map((t) => {
        const who = t.name || t.username || 'บุคคลทั่วไป (แขก)';
        const lastFrom = t.last?.from === 'admin' ? 'คุณ' : who;
        return `<div class="msg-card${t.status === 'open' && !t.read ? ' unread' : ''}" style="cursor:pointer" data-topen="${esc(t.id)}">
          <div class="msg-head">
            ${t.status === 'open' && !t.read ? '<span class="msg-dot" title="ยังไม่ได้อ่าน"></span>' : ''}
            <span class="msg-who">${esc(who)}</span>
            ${t.userUid ? `<span class="mono" style="color:var(--brand);font-size:.76rem;font-weight:600">${esc(t.userUid)}</span>` : ''}
            ${t.username ? `<span style="color:var(--muted);font-size:.8rem">@${esc(t.username)}</span>` : ''}
            ${t.topic ? `<span class="ti-status st-open">${esc(t.topic)}</span>` : ''}
            ${t.issueType ? `<span class="ti-topic">${esc(t.issueType)}</span>` : ''}
            ${t.productCode ? `<span class="mono" style="color:var(--brand);font-size:.78rem;font-weight:600">สินค้า ${esc(t.productCode)}</span>` : ''}
            <span class="ti-status st-${t.status}">${t.status === 'open' ? 'เปิดอยู่' : 'ปิดแล้ว'}</span>
            <span class="msg-when">${dt(t.updatedAt)}</span>
          </div>
          <div class="msg-body">${esc((t.last?.text || '').slice(0, 120))}</div>
          <div class="msg-contact">${lastFrom} · ${t.count} ข้อความ${t.contact ? ' · ติดต่อกลับ: ' + esc(t.contact) : ''} — แตะเพื่อเปิดแชท</div>
        </div>`;
      })
      .join('');
    $('messagesBox').querySelectorAll('[data-topen]').forEach((card) => {
      card.onclick = () => openTicketChat(card.dataset.topen);
    });
  } catch (e) {
    $('messagesBox').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

function adminBubble(m) {
  const mine = m.from === 'admin';
  return `<div class="chat-bubble ${mine ? 'me' : 'admin'}">
    <div class="cb-text">${esc(m.text)}</div>
    <div class="cb-time">${dt(m.at)}</div>
  </div>`;
}

async function openTicketChat(id) {
  try {
    const res = await api('/api/admin/ticket-thread?id=' + encodeURIComponent(id));
    const t = res.ticket;
    const who = t.name || t.username || 'บุคคลทั่วไป';
    const open = t.status === 'open';
    $('ticketChatBody').innerHTML = `
      <h2>เคส ${esc(t.id)} <span class="ti-status st-${t.status}">${open ? 'เปิดอยู่' : 'ปิดแล้ว'}</span></h2>
      <p class="sub">${esc(who)}${t.username ? ' @' + esc(t.username) : ''}${t.topic ? ' · ' + esc(t.topic) : ''}${t.issueType ? ' · <b style="color:var(--danger)">' + esc(t.issueType) + '</b>' : ''}${t.productCode ? ' · สินค้า: <b class="mono" style="color:var(--brand)">' + esc(t.productCode) + '</b>' : ''}${t.issueDate ? ' · พบปัญหาวันที่ ' + esc(t.issueDate) : ''}${t.contact ? ' · ติดต่อกลับ: ' + esc(t.contact) : ''}</p>
      ${t.orderLink ? `<div style="margin:-6px 0 10px"><a class="link-box" href="${esc(t.orderLink)}" target="_blank" rel="noopener">${esc(t.orderLink)}</a></div>` : ''}
      <div class="chat-scroll">${t.messages.map(adminBubble).join('')}</div>
      ${open
        ? `<div class="chat-reply-row">
             <textarea id="acReply" rows="2" maxlength="2000" placeholder="พิมพ์คำตอบถึงลูกค้า..."></textarea>
             <button class="btn btn-primary" id="acSendBtn">ส่ง</button>
           </div>
           <div class="btn-row" style="margin-top:8px">
             <button class="btn btn-success btn-sm" id="acCloseBtn" style="flex:1">ปิดเคส (คุยจบแล้ว)</button>
             <button class="btn btn-danger btn-sm" id="acDelBtn" style="flex:1">ลบเคสนี้</button>
           </div>`
        : `<div class="btn-row" style="margin-top:8px">
             <button class="btn btn-ghost btn-sm" id="acReopenBtn" style="flex:1">เปิดเคสใหม่</button>
             <button class="btn btn-danger btn-sm" id="acDelBtn" style="flex:1">ลบเคสนี้</button>
           </div>`}`;
    const scroll = document.querySelector('#ticketChatModal .chat-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
    const send = $('acSendBtn');
    if (send) {
      send.onclick = async () => {
        const text = $('acReply').value.trim();
        if (!text) return;
        send.disabled = true;
        try {
          await api('/api/admin/ticket-reply', { method: 'POST', body: { id, text } });
          toast('ตอบกลับลูกค้าแล้ว — ลูกค้าเห็นในห้องแชทของเขาทันที', 'ok');
          openTicketChat(id);
          loadMessages();
        } catch (e) {
          toast(e.message, 'err');
        } finally {
          send.disabled = false;
        }
      };
    }
    const closeBtn = $('acCloseBtn');
    if (closeBtn) closeBtn.onclick = async () => {
      if (!confirm('ปิดเคสนี้? ลูกค้าจะเห็นสถานะ "ปิดแล้ว" และตอบกลับต่อไม่ได้ (เปิดใหม่ได้ภายหลัง)')) return;
      await ticketAction(id, 'close');
      openTicketChat(id);
    };
    const reopenBtn = $('acReopenBtn');
    if (reopenBtn) reopenBtn.onclick = async () => {
      await ticketAction(id, 'open');
      openTicketChat(id);
    };
    const delBtn = $('acDelBtn');
    if (delBtn) delBtn.onclick = async () => {
      if (!confirm('ลบเคสนี้ถาวรพร้อมประวัติการคุยทั้งหมด?')) return;
      await ticketAction(id, 'delete');
      closeModal('ticketChatModal');
    };
    openModal('ticketChatModal');
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function ticketAction(id, action) {
  try {
    const res = await api('/api/admin/message-action', { method: 'POST', body: { id, action } });
    updateContactBadge(res.unread || 0);
    loadMessages();
    if (action === 'close') toast('ปิดเคสเรียบร้อย', 'ok');
    if (action === 'open') toast('เปิดเคสใหม่แล้ว', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ---------- ภาพรวม ---------- */
async function loadOverview() {
  try {
    const res = await api('/api/admin/overview');
    // อัปเดตป้ายข้อความใหม่แบบเงียบ ๆ ให้เห็นโดยไม่ต้องเข้าแท็บติดต่อ
    api('/api/admin/messages').then((r) => updateContactBadge(r.unread || 0)).catch(() => {});
    const s = res.stats;
    $('kpiGrid').innerHTML = `
      <div class="kpi v-green"><div class="lbl">รายได้รวม</div><div class="num green">${money(s.revenue)} ฿</div></div>
      <div class="kpi v-cyan"><div class="lbl">ต้นทุนรวม</div><div class="num cyan">${money(s.cost)} ฿</div></div>
      <div class="kpi v-pink"><div class="lbl">กำไรสุทธิ</div><div class="num pink">${money(s.profit)} ฿</div></div>
      <div class="kpi"><div class="lbl">ออเดอร์ทั้งหมด</div><div class="num">${s.orders}</div></div>
      <div class="kpi"><div class="lbl">สมาชิก</div><div class="num">${s.users}</div></div>
      <div class="kpi v-amber"><div class="lbl">เครดิตลูกค้าคงเหลือรวม</div><div class="num amber">${money(s.userCredits)} ฿</div></div>
      <div class="kpi v-amber"><div class="lbl">เติมเงินรออนุมัติ</div><div class="num amber">${s.pendingTopups}</div></div>
      <div class="kpi"><div class="lbl">บริการในระบบ</div><div class="num">${s.services}</div></div>
      <div class="kpi v-amber"><div class="lbl">ปิดชั่วคราว (ต้นทาง)</div><div class="num amber">${s.hiddenServices ?? 0}</div></div>`;
    const up = res.upstream;
    // ---- ส่วนการเชื่อมต่อ API ต้นทาง ----
    const ok = !!(up && up.balance !== undefined);
    const dot = $('apiStatusDot');
    if (dot) dot.className = 'status-dot ' + (ok ? 'ok' : 'down');
    const stTxt = $('apiStatusTxt');
    if (stTxt) {
      stTxt.textContent = ok ? 'เชื่อมต่อปกติ' : 'เชื่อมต่อไม่สำเร็จ';
      stTxt.style.color = ok ? 'var(--green)' : 'var(--danger)';
    }
    const prov = $('apiProvider');
    if (prov) prov.textContent = up?.provider === 'smm24hr' ? 'smm24hr.net (สำรอง)' : 'kmm-th.com';
    const contact = $('apiContactLink');
    if (contact && up && up.contactUrl) {
      contact.href = up.contactUrl;
      contact.textContent = up.contactLabel || up.contactUrl;
    }
    $('upstreamBal').textContent = ok
      ? `${money(up.balance)} ${up.currency || 'THB'}`
      : esc(up?.error || up?.message || 'ลองกดทดสอบอีกครั้ง');
    const svcEl = $('apiServices');
    if (svcEl) svcEl.textContent = `${Number(s.services).toLocaleString()} รายการ`;
    const at = $('apiServicesAt');
    if (at) at.textContent = res.servicesAt ? `(ดึงล่าสุด ${dt(res.servicesAt)})` : '';
    const checked = $('apiCheckedAt');
    if (checked) checked.textContent = dt(Date.now());
    // ปุ่มเติมเครดิตต้นทาง — ลิงก์และชื่อเจ้าเปลี่ยนตามผู้ให้บริการที่ใช้อยู่
    const topupBtn = $('topupUpstreamBtn');
    if (topupBtn && up && up.topupUrl) {
      topupBtn.href = up.topupUrl;
      topupBtn.textContent = `ไปเติมเครดิตต้นทาง (${up.provider === 'smm24hr' ? 'smm24hr.net' : 'kmm-th.com'})`;
    }
  } catch (e) {
    toast(e.message, 'err');
  }
}


// ---------- โหมดมืด-สว่าง ----------
(function initTheme() {
  const LIGHT = '#223041';
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

/* ---------- ตั้งค่า ---------- */
async function loadSettings() {
  try {
    const res = await api('/api/admin/overview');
    const s = res.settings;
    $('setMarkup').value = s.markupPercent;
    $('setMinPer1000').value = s.minPer1000;
    $('setMinOrder').value = s.minOrderPrice;
    $('setPromptpay').value = s.promptPayId || '';
    $('setSiteName').value = s.siteName || '';
    $('setLine').value = s.lineContact || '';
    $('setTagline').value = s.tagline || '';
    $('setTopupMin').value = s.topupMin ?? 10;
    $('setTopupMax').value = s.topupMax ?? 100000;
    $('setTopupAmounts').value = s.topupAmounts || '50,100,200,500,1000';
    $('svcInfo').textContent = `บริการในระบบ ${res.stats.services} รายการ — อัปเดตล่าสุด ${res.servicesAt ? dt(res.servicesAt) : '—'}`;
  } catch (e) {
    toast(e.message, 'err');
  }
}
$('saveSettingsBtn').onclick = async () => {
  try {
    await api('/api/admin/settings', {
      method: 'POST',
      body: {
        markupPercent: Number($('setMarkup').value),
        minPer1000: Number($('setMinPer1000').value),
        minOrderPrice: Number($('setMinOrder').value),
        promptPayId: $('setPromptpay').value.trim(),
        siteName: $('setSiteName').value.trim(),
        lineContact: $('setLine').value.trim(),
        tagline: $('setTagline').value.trim(),
        topupMin: Number($('setTopupMin').value),
        topupMax: Number($('setTopupMax').value),
        topupAmounts: $('setTopupAmounts').value.trim(),
      },
    });
    toast('บันทึกการตั้งค่าเรียบร้อย — ราคาทุกรายการอัปเดตทันที', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  }
};
// ปุ่มทดสอบการเชื่อมต่อ API ต้นทาง — ยิงตรวจสดใหม่
$('apiTestBtn').onclick = async () => {
  const btn = $('apiTestBtn');
  btn.disabled = true;
  const txt = $('apiStatusTxt');
  if (txt) { txt.textContent = 'กำลังทดสอบ…'; txt.style.color = 'var(--muted)'; }
  try {
    await loadOverview();
    toast('ทดสอบการเชื่อมต่อเรียบร้อย');
  } catch (e) {
    toast(e.message, 'err');
  }
  btn.disabled = false;
};

$('refreshSvcBtn').onclick = async () => {  const btn = $('refreshSvcBtn');
  btn.disabled = true;
  btn.textContent = 'กำลังดึงข้อมูล...';
  try {
    const res = await api('/api/admin/services-refresh', { method: 'POST' });
    toast(`ดึงบริการล่าสุดแล้ว ${res.count} รายการ`, 'ok');
    loadOverview();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'ดึงราคาล่าสุดจากผู้ให้บริการ';
  }
};

/* ---------- เติมเงิน ---------- */
async function loadTopups() {
  try {
    const res = await api('/api/admin/topups');
    const list = res.topups;
    if (!list.length) {
      $('topupsBox').innerHTML = `<div class="empty"><div class="big"></div>ยังไม่มีรายการเติมเงิน</div>`;
      return;
    }
    $('topupsBox').innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>รหัส</th><th>ผู้ใช้</th><th>ยอด</th><th>สลิป</th><th>อ้างอิง</th><th>สถานะ</th><th>วันที่</th><th></th></tr></thead>
      <tbody>${list
        .map(
          (t) => `<tr>
            <td class="mono" data-label="รหัส">${esc(t.id)}</td>
            <td data-label="ผู้ใช้">${esc(t.username)}${t.refReward ? `<br /><span style="color:var(--money);font-size:.72rem;font-weight:600">อนุมัติ → ${esc(t.refReward.referrerName)} ได้รางวัลแนะนำ ${t.refReward.amount}฿</span>` : ''}</td>
            <td class="mono" data-label="ยอด"><b>${money(t.amount)} ฿</b></td>
            <td data-label="สลิป">${t.slipFile ? `<a href="/slips/${esc(t.slipFile)}" target="_blank" title="คลิกดูสลิปเต็ม"><img class="slip-thumb" src="/slips/${esc(t.slipFile)}" alt="สลิป" /></a>` : '<span style="color:var(--muted)">—</span>'}</td>
            <td data-label="อ้างอิง">${esc(t.ref || '—')}</td>
            <td data-label="สถานะ"><span class="status-pill st-${esc(t.status)}">${t.status === 'pending' ? 'รออนุมัติ' : t.status === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธ'}</span></td>
            <td style="white-space:nowrap;color:var(--muted);font-size:.8rem" data-label="วันที่">${dt(t.createdAt)}</td>
            <td style="white-space:nowrap" data-label="จัดการ">${
              t.status === 'pending'
                ? `<button class="btn btn-success btn-sm" data-ok="${esc(t.id)}"> อนุมัติ</button> <button class="btn btn-danger btn-sm" data-no="${esc(t.id)}"> ปฏิเสธ</button>`
                : ''
            }</td>
          </tr>`
        )
        .join('')}</tbody></table></div>`;
    $('topupsBox').querySelectorAll('[data-ok]').forEach((b) => {
      b.onclick = () => topupAction(b.dataset.ok, 'approve');
    });
    $('topupsBox').querySelectorAll('[data-no]').forEach((b) => {
      b.onclick = () => topupAction(b.dataset.no, 'reject');
    });
  } catch (e) {
    $('topupsBox').innerHTML = `<div class="empty"> ${esc(e.message)}</div>`;
  }
}
async function topupAction(id, action) {
  try {
    await api('/api/admin/topup-action', { method: 'POST', body: { id, action } });
    toast(action === 'approve' ? 'อนุมัติและเพิ่มเครดิตให้ลูกค้าแล้ว' : 'ปฏิเสธรายการแล้ว', 'ok');
    loadTopups();
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ---------- คำสั่งซื้อ ---------- */
function thaiStatus(st) {
  const map = { pending: 'รอดำเนินการ', processing: 'กำลังดำเนินการ', completed: 'สำเร็จ', partial: 'บางส่วน', canceled: 'ยกเลิก', refunded: 'คืนเงินแล้ว', error: 'ผิดพลาด' };
  return map[String(st || '').toLowerCase()] || st || '—';
}
async function loadOrders(refresh) {
  try {
    const res = await api('/api/admin/orders' + (refresh ? '?refresh=1' : ''));
    const list = res.orders;
    if (!list.length) {
      $('ordersBox').innerHTML = `<div class="empty"><div class="big"></div>ยังไม่มีคำสั่งซื้อ</div>`;
      return;
    }
    $('ordersBox').innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>เลขที่</th><th>รหัสคำสั่งซื้อ</th><th>ผู้ใช้</th><th>บริการ</th><th>ลิงก์ที่สั่ง</th><th>จำนวน</th><th>ยอดเงิน</th><th>สถานะ</th><th>วันที่เวลา</th></tr></thead>
      <tbody>${list
        .map((o) => {
          const cost = o.charge != null ? Number(o.charge) : o.estCost;
          return `<tr>
            <td class="mono" data-label="เลขที่">${esc(o.id)}</td>
            <td data-label="รหัสคำสั่งซื้อ">${o.upstreamOrder ? `<span class="code-box code-copy" data-copy="${esc(o.upstreamOrder)}" title="คลิกเพื่อคัดลอก">${esc(o.upstreamOrder)}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
            <td data-label="ผู้ใช้">${esc(o.username)}</td>
            <td data-label="บริการ / เลขสินค้า">
              <span class="cell-clip" title="${esc(o.serviceName)}">${esc(o.serviceName)}</span><br />
              <span style="color:var(--muted);font-size:.72rem">เลขสินค้า ${esc(o.serviceId ?? '—')}</span>
            </td>
            <td data-label="ลิงก์ที่สั่ง">${/^https?:\/\//i.test(o.link || '') ? `<a class="link-box" href="${esc(o.link)}" target="_blank" rel="noopener" title="${esc(o.link)}">${esc(o.link)}</a>` : '<span style="color:var(--muted)">—</span>'}</td>
            <td class="mono" data-label="จำนวน">${Number(o.quantity).toLocaleString()}</td>
            <td data-label="ยอดเงิน (ขาย/ต้นทุน/กำไร)">
              <div>ขาย <b class="mono">${money(o.price)} ฿</b></div>
              <div style="color:var(--muted);font-size:.78rem">ต้นทุน ${o.status === 'Error' ? '—' : money(cost) + ' ฿'}</div>
              <div style="color:var(--green);font-size:.78rem">กำไร ${o.status === 'Error' ? '—' : money(o.price - cost) + ' ฿'}</div>
            </td>
            <td data-label="สถานะ">
              <span class="status-pill st-${esc(String(o.status).toLowerCase())}">${esc(thaiStatus(o.status))}</span>
              ${o.refundedToUser ? `<br /><span style="color:var(--money);font-size:.72rem;font-weight:600">คืนเครดิตแล้ว ${money(o.refundedAmount || o.price)} ฿</span>` : (o.error ? `<br /><span style="color:var(--red);font-size:.72rem">${esc(o.error)}</span>` : '')}
            </td>
            <td style="white-space:nowrap;color:var(--muted);font-size:.78rem" data-label="วันที่เวลา">${dt(o.createdAt)}</td>
          </tr>`;
        })
        .join('')}</tbody></table></div>`;
    wireCopyToClipboard('ordersBox');
  } catch (e) {
    $('ordersBox').innerHTML = `<div class="empty"> ${esc(e.message)}</div>`;
  }
}
$('refreshOrdersBtn').onclick = () => {
  toast('กำลังดึงสถานะล่าสุด...');
  loadOrders(true);
};

/* ---------- สมาชิก ---------- */
async function loadUsers() {
  try {
    const res = await api('/api/admin/users');
    const list = res.users;
    if (!list.length) {
      $('usersBox').innerHTML = `<div class="empty"><div class="big"></div>ยังไม่มีสมาชิก</div>`;
      return;
    }
    $('usersBox').innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>รหัส</th><th>ผู้ใช้</th><th>เบอร์โทร</th><th>ชื่อ</th><th>เครดิต</th><th>ออเดอร์</th><th>แนะนำเพื่อน</th><th>สมัครเมื่อ</th><th>จัดการ</th></tr></thead>
      <tbody>${list
        .map(
          (u) => `<tr>
            <td class="mono" data-label="รหัสสมาชิก"><span class="code-box">${esc(u.uid || '—')}</span></td>
            <td class="mono" data-label="ผู้ใช้">${esc(u.username)}${u.refByUid ? `<br /><span style="color:var(--muted);font-size:.7rem">แนะนำโดย ${esc(u.refByUid)}</span>` : ''}</td>
            <td class="mono" data-label="เบอร์โทร">${esc(u.phone || '—')}</td>
            <td data-label="ชื่อ">${esc(u.name)}</td>
            <td class="mono" data-label="เครดิต"><b style="color:var(--green)">${money(u.balance)} ฿</b></td>
            <td class="mono" data-label="ออเดอร์">${u.orderCount}</td>
            <td class="mono" data-label="แนะนำเพื่อน" style="color:var(--money)">${u.refCount || 0}/10 คน<br /><span style="font-size:.72rem">รับไป ${money(u.refEarned || 0)} ฿</span></td>
            <td style="color:var(--muted);font-size:.8rem" data-label="สมัครเมื่อ">${dt(u.createdAt)}</td>
            <td style="white-space:nowrap" data-label="จัดการ"><button class="btn btn-ghost btn-sm" data-uedit="${esc(u.username)}">แก้ไข</button> <button class="btn btn-danger btn-sm" data-udel="${esc(u.username)}">ลบ</button></td>
          </tr>`
        )
        .join('')}</tbody></table></div>`;
    $('usersBox').querySelectorAll('[data-uedit]').forEach((b) => {
      b.onclick = () => openEditUser(b.dataset.uedit);
    });
    $('usersBox').querySelectorAll('[data-udel]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm(`ลบสมาชิก "${b.dataset.udel}" ออกจากระบบ?\n(ประวัติออเดอร์จะเก็บไว้เป็นหลักฐานบัญชี)`)) return;
        try {
          await api('/api/admin/user-delete', { method: 'POST', body: { username: b.dataset.udel } });
          toast('ลบสมาชิกแล้ว', 'ok');
          loadUsers();
        } catch (e) { toast(e.message, 'err'); }
      };
    });
  } catch (e) {
    $('usersBox').innerHTML = `<div class="empty"> ${esc(e.message)}</div>`;
  }
}

/* ---------- Modal แก้ไข ---------- */
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

let editingUser = null;
function openEditUser(username) {
  editingUser = username;
  $('euUsername').textContent = username;
  $('euName').value = '';
  $('euBalance').value = '';
  $('euPassword').value = '';
  openModal('editUserModal');
}
$('euSaveBtn').onclick = async () => {
  const body = { username: editingUser };
  if ($('euName').value.trim()) body.name = $('euName').value.trim();
  if ($('euBalance').value !== '') body.balance = Number($('euBalance').value);
  if ($('euPassword').value) body.password = $('euPassword').value;
  try {
    const res = await api('/api/admin/user-update', { method: 'POST', body });
    toast(`บันทึกแล้ว เครดิตปัจจุบัน ${money(res.user.balance)} ฿`, 'ok');
    closeModal('editUserModal');
    loadUsers();
  } catch (e) { toast(e.message, 'err'); }
};

let editingOrder = null;
function openEditOrder(id) {
  editingOrder = id;
  $('eoId').textContent = id;
  openModal('editOrderModal');
}
$('eoSaveBtn').onclick = async () => {
  try {
    await api('/api/admin/order-update', { method: 'POST', body: { id: editingOrder, status: $('eoStatus').value } });
    toast('บันทึกสถานะแล้ว', 'ok');
    closeModal('editOrderModal');
    loadOrders(false);
  } catch (e) { toast(e.message, 'err'); }
};

let editingTopup = null;
function openEditTopup(id) {
  editingTopup = id;
  $('etId').textContent = id;
  $('etAmount').value = '';
  $('etRef').value = '';
  openModal('editTopupModal');
}
$('etSaveBtn').onclick = async () => {
  const body = { id: editingTopup };
  if ($('etAmount').value !== '') body.amount = Number($('etAmount').value);
  body.ref = $('etRef').value.trim();
  try {
    await api('/api/admin/topup-update', { method: 'POST', body });
    toast('บันทึกการแก้ไขแล้ว', 'ok');
    closeModal('editTopupModal');
    loadTopups();
  } catch (e) { toast(e.message, 'err'); }
};
$('creditBtn').onclick = async () => {
  const username = $('creditUser').value.trim();
  const amount = Number($('creditAmt').value);
  if (!username || !isFinite(amount) || amount === 0) return toast('กรอกชื่อผู้ใช้และจำนวนเงิน', 'err');
  try {
    const res = await api('/api/admin/credit', { method: 'POST', body: { username, amount } });
    toast(`ปรับเครดิต ${username} เป็น ${money(res.user.balance)} ฿ แล้ว`, 'ok');
    loadUsers();
  } catch (e) {
    toast(e.message, 'err');
  }
};

/* ---------- การแจ้งเตือน push ---------- */
function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((ch) => ch.charCodeAt(0)));
}
async function initPush() {
  const btn = $('pushEnableBtn');
  const testBtn = $('pushTestBtn');
  const st = $('pushStatus');
  if (!btn) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    st.textContent = 'เบราว์เซอร์นี้ยังไม่รองรับ — iPhone ให้เพิ่มเว็บเป็นแอปหน้าจอโฮมแล้วเปิดจากไอคอนนั้น';
    return;
  }
  const reg = await navigator.serviceWorker.register('/sw.js').catch(() => null);
  if (!reg) { st.textContent = 'เปิด service worker ไม่สำเร็จ ลองรีเฟรชหน้า'; return; }
  const sub = await reg.pushManager.getSubscription();
  const label = (perm) =>
    perm === 'granted' ? 'อุปกรณ์นี้เปิดแจ้งเตือนแล้ว — จะมีเสียง+แจ้งเตือนทันทีที่มีลูกค้าแจ้งโอนหรือสั่งออเดอร์' : 'ยังไม่เปิด — กดปุ่ม "เปิดการแจ้งเตือนบนอุปกรณ์นี้" แล้วกด "อนุญาต"';
  st.textContent = label(Notification.permission) + (sub ? '' : '');
  btn.onclick = async () => {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { st.textContent = 'ถูกปฏิเสธ — ไปตั้งค่าแอปนี้ในเครื่องแล้วเปิดการแจ้งเตือน'; return; }
      const keyRes = await api('/api/push/vapidkey');
      const newSub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(keyRes.key),
      });
      await api('/api/push/subscribe', { method: 'POST', body: newSub.toJSON() });
      st.textContent = 'อุปกรณ์นี้เปิดแจ้งเตือนแล้ว — ลองกดปุ่ม "ส่งแจ้งเตือนทดสอบ" ดูได้';
      toast('เปิดการแจ้งเตือนสำเร็จ', 'ok');
    } catch (e) {
      toast('เปิดไม่สำเร็จ: ' + e.message, 'err');
    }
  };
  testBtn.onclick = async () => {
    try {
      const r = await api('/api/push/test', { method: 'POST' });
      toast(r.result && r.result.sent > 0 ? 'ส่งแล้ว ' + r.result.sent + ' อุปกรณ์ — ดูแจ้งเตือนบนมือถือ' : 'ยังไม่มีอุปกรณ์ที่เปิดรับ (กดปุ่มเปิดก่อน)', r.result && r.result.sent > 0 ? 'ok' : 'err');
    } catch (e) { toast(e.message, 'err'); }
  };
}
initPush();

/* ---------- เริ่มระบบ: เช็คว่าล็อกอินแอดมินอยู่แล้วหรือยัง ---------- */
async function init() {
  try {
    const res = await fetch('/api/admin/overview');
    if (res.ok) {
      showApp();
      return;
    }
    if (res.status === 403) {
      showLogin(); // จริง ๆ ไม่มีสิทธิ์เท่านั้นที่กลับไปหน้าล็อกอิน
      return;
    }
    // 500 / เซิร์ฟเวอร์ติดขัดชั่วคราว → เข้าแดชบอร์ดไปก่อน จะแสดง error เอง (session ยังอยู่)
    showApp();
  } catch {
    showApp();
  }
}
function loadAll() {
  loadOverview();
  loadSettings();
  loadTopups();
  loadOrders(false);
  loadUsers();
}

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

init();

/* ---------- ช่องค้นหาแต่ละแท็บ: กรองสด ๆ ขณะพิมพ์ ---------- */
function wireAdminSearch(inputId, boxId) {
  const inp = $(inputId);
  const box = $(boxId);
  if (!inp || !box) return;
  const applyFilter = () => {
    const q = inp.value.trim().toLowerCase();
    // กรณีตาราง (จอกว้าง) กรองทีละแถว tr / กรณีการ์ด (มือถือ) กรองลูกตรง ๆ
    const rows = box.querySelectorAll('tbody tr');
    const targets = rows.length ? rows : box.children;
    [...targets].forEach((el) => {
      const t = (el.textContent || '').toLowerCase();
      el.style.display = !q || t.includes(q) ? '' : 'none';
    });
  };
  inp.addEventListener('input', applyFilter);
}
wireAdminSearch('ordersSearch', 'ordersBox');
wireAdminSearch('topupsSearch', 'topupsBox');
wireAdminSearch('usersSearch', 'usersBox');
wireAdminSearch('messagesSearch', 'messagesBox');

/* ---------- เฝ้าดูเคสใหม่แบบสด: จุดแดงเด้งเอง ไม่ต้องรีเฟรชหน้า ---------- */
let lastUnreadTickets = null;
setInterval(async () => {
  try {
    const r = await api('/api/admin/messages');
    updateContactBadge(r.unread || 0);
    // เพิ่งมีข้อความใหม่จากลูกค้า (เคสใหม่ หรือตอบกลับในเคสเดิม)
    if (lastUnreadTickets !== null && (r.unread || 0) > lastUnreadTickets) {
      const latest = (r.messages || [])[0];
      toast(latest && latest.status === 'open' && latest.count === 1
        ? 'มีเคสใหม่จากลูกค้า! ตรวจสอบที่แท็บติดต่อ'
        : 'ลูกค้าตอบกลับเคส — ตรวจสอบที่แท็บติดต่อ', 'ok');
      // ถ้ากำลังเปิดแท็บติดต่ออยู่ ดึงรายการใหม่ให้ทันที
      const activeTab = document.querySelector('.admin-tabs button.active');
      if (activeTab && activeTab.dataset.tab === 'contact') { loadMessages(); }
    }
    lastUnreadTickets = r.unread || 0;
  } catch { /* เน็ตสะดุดชั่วครู่ รอรอบหน้า */ }
}, 15000);

/* คลิกอิลิเมนต์ [data-copy] แล้วคัดลอกค่า พร้อม toast */
function wireCopyToClipboard(boxId) {
  const box = $(boxId);
  if (!box) return;
  box.querySelectorAll('[data-copy]').forEach((el) => {
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
