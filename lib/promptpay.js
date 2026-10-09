// สร้าง Payload QR พร้อมเพย์ (มาตรฐาน EMVCo) เพื่อให้ลูกค้าสแกนจ่ายเงินได้
function tlv(id, value) {
  const v = String(value);
  return id + String(v.length).padStart(2, '0') + v;
}

// CRC-16/CCITT-FALSE — คิดจาก ASCII ของ payload โดยตรง (1 อักษร = 1 byte)
function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function promptPayPayload(idOrPhone, amount) {
  const digits = String(idOrPhone).replace(/\D/g, '');
  let target;
  if (digits.length === 13 || digits.length === 15) {
    target = tlv('02', digits); // เลขบัตรประชาชน / นิติบุคคล
  } else if (digits.length >= 9) {
    let phone = digits;
    if (phone.startsWith('0')) phone = '66' + phone.slice(1); // 08x-xxx → 668x
    // มาตรฐาน MSISDN ของพร้อมเพย์: ต้องมี "00" นำหน้ารหัสประเทศ เช่น 0066814178154
    if (phone.length >= 10 && phone.length <= 13) {
      target = tlv('01', '00' + phone);
    }
  }
  if (!target) return null;

  const merchant = tlv('29', tlv('00', 'A000000677010111') + target);
  const parts = [
    '000201', // Payload Format
    '010212', // Point of Initiation (dynamic — มียอดเงิน)
    merchant,
    tlv('58', 'TH'), // ประเทศ
    tlv('53', '764'), // สกุลเงิน THB
    amount ? tlv('54', Number(amount).toFixed(2)) : '',
  ].filter(Boolean);

  const payload = parts.join('') + '6304';
  return payload + crc16(payload);
}
