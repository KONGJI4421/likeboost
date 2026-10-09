# LikeBoost — SMM Reseller Panel

ระบบร้านปั้มไลค์ วิว ฟอล โซเชียลมีเดีย ภาษาไทย ครบวงจร

## ติดตั้ง
```bash
cp .env.example .env   # แล้วแก้ค่าในไฟล์
npm install
node server.js
```

## โครงสร้าง
- `server.js` — เซิร์ฟเวอร์หลัก (Node.js ล้วน ไม่มี dependency เพิ่ม)
- `lib/` — ตัวเชื่อม API ต้นทาง (kmm/smm24hr), ระบบราคา, push
- `public/` — หน้าเว็บ + แอดมิน
- `data/` — ฐานข้อมูล JSON (ไม่ขึ้น Git — สำรองแยก)
