// ระบบราคา + กำไร: ต้นทุนจาก upstream จะถูกบวกกำไรก่อนแสดงลูกค้าเสมอ
// ต้นทุนดิบ (cost rate) ห้ามหลุดออกไปยังฝั่งลูกค้าโดยเด็ดขาด

export function sellRate(costRate, settings) {
  const cost = Number(costRate);
  if (!isFinite(cost) || cost < 0) return 0;
  const percent = Number(settings.markupPercent ?? 0);
  const minPer1000 = Number(settings.minPer1000 ?? 0);
  let rate = cost * (1 + percent / 100);
  if (rate - cost < minPer1000) rate = cost + minPer1000;
  return Math.round(rate * 100) / 100; // ปัด 2 ตำแหน่งแบบปกติ — ตรงกับสูตรที่แสดงลูกค้าทุกบาท
}

export function orderPrice(ratePer1000, quantity, settings) {
  const rate = Number(ratePer1000);
  const qty = Number(quantity);
  if (!isFinite(rate) || !isFinite(qty) || qty <= 0) return 0;
  const minOrder = Number(settings.minOrderPrice ?? 0);
  const raw = (rate * qty) / 1000;
  if (minOrder <= 0 || raw >= minOrder) return Math.round(raw * 100) / 100;
  if (rate <= 0) return Math.round(minOrder * 100) / 100;
  // โซนออเดอร์เล็ก: ไล่ราคาจากครึ่งขั้นต่ำขึ้นไปจนถึงขั้นต่ำพอดีที่จุดคุ้มทุน
  // — ยอดขยับทุกครั้งที่เพิ่มจำนวน และยิ่งซื้อมากยิ่งถูกลงต่อชิ้น
  const breakeven = (minOrder / rate) * 1000;
  const tapered = minOrder * (0.5 + (0.5 * Math.min(qty, breakeven)) / breakeven);
  return Math.round(Math.max(raw, tapered) * 100) / 100;
}

export function estCost(costRate, quantity) {
  return Math.round((Number(costRate) * Number(quantity)) / 1000 * 100) / 100;
}
