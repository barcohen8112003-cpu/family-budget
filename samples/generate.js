// יוצר קבצי דוגמה פיקטיביים: תדפיס בנק (CSV, UTF-8), ישראכרט (CSV, Windows-1255), מקס (xls בפורמט HTML)
// הרצה: node samples/generate.js
const fs = require('fs');
const path = require('path');

let seed = 42;
const rnd = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a, b) => Math.round((a + rnd() * (b - a)) * 10) / 10;
const p2 = (n) => String(n).padStart(2, '0');
const dmy = (y, m, d) => `${p2(d)}/${p2(m)}/${y}`;
const money = (n) => n.toFixed(2);
const moneyComma = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MONTHS = [[2026, 7], [2026, 8], [2026, 9], [2026, 10]];
const LAST_DAY = { 10: 5 }; // אוקטובר חלקי
const nextMonth = (y, m) => (m === 12 ? [y + 1, 1] : [y, m + 1]);
const chargeDate = (y, m) => { const [ny, nm] = nextMonth(y, m); return dmy(ny, nm, 10); };

const isra = []; // {y,m,d,name,orig,charge,extra,branch,chargeDate}
const max = [];
const push = (list, y, m, d, name, amount, branch, extra = '', orig = null, charge = null) => {
  if (LAST_DAY[m] && d > LAST_DAY[m]) return;
  list.push({ y, m, d, name, orig: orig ?? amount, amount, extra, branch, charge: charge ?? chargeDate(y, m) });
};

for (const [y, m] of MONTHS) {
  // ישראכרט: מנויים וקבועים
  push(isra, y, m, 1, 'מכבי שירותי בריאות', 186.4, 'רפואה');
  push(isra, y, m, 2, 'הולמס פלייס רמת גן', 289, 'פנאי וספורט');
  push(isra, y, m, 3, 'NETFLIX.COM', 54.9, 'פנאי ובילוי');
  push(isra, y, m, 4, 'פרטנר תקשורת', 119.9, 'תקשורת');
  push(isra, y, m, 5, 'SPOTIFY', 23.9, 'פנאי ובילוי');
  push(isra, y, m, 6, 'בזק החברה הישראלית לתקשורת', 99, 'תקשורת');
  push(isra, y, m, 8, 'HOT מובייל', 59.9, 'תקשורת');
  // סופר
  for (const d of [3, 10, 17, 24]) push(isra, y, m, d, 'שופרסל דיל רמת גן', between(380, 720), 'מזון');
  for (const d of [7, 21]) push(isra, y, m, d, 'רמי לוי שיווק השקמה', between(300, 600), 'מזון');
  // דלק ותחבורה
  for (const d of [6, 20]) push(isra, y, m, d, 'פז יילו גבעתיים', between(240, 330), 'דלק');
  push(isra, y, m, 13, 'סונול דרך השלום', between(200, 300), 'דלק');
  push(isra, y, m, 9, 'רב-קו אונליין', 100, 'תחבורה');
  // מסעדות
  push(isra, y, m, 5, 'ארומה ישראל', between(38, 75), 'מסעדות');
  push(isra, y, m, 11, "מקדונלד'ס איילון", between(90, 160), 'מסעדות');
  push(isra, y, m, 14, 'WOLT', between(95, 180), 'מסעדות');
  push(isra, y, m, 19, 'גולדה גלידה', between(40, 80), 'מסעדות');
  push(isra, y, m, 26, "ג'פניקה", between(180, 320), 'מסעדות');
  push(isra, y, m, 12, 'סופר-פארם קניון איילון', between(80, 240), 'פארם');

  // מקס
  push(max, y, m, 2, 'APPLE.COM/BILL', 34.9, 'פנאי');
  push(max, y, m, 15, 'YES שירותי לוויין', 219, 'תקשורת');
  push(max, y, m, 4, 'AMAZON MKTPLACE', between(90, 380), 'קניות');
  push(max, y, m, 16, 'ALIEXPRESS', between(40, 160), 'קניות');
  push(max, y, m, 9, 'טיב טעם רמת החייל', between(150, 320), 'מזון');
  push(max, y, m, 18, 'פנגו חניה', between(25, 70), 'רכב');
  push(max, y, m, 23, 'סטימצקי', between(60, 140), 'ספרים');
}
// חד-פעמיות
push(isra, 2026, 7, 22, 'פוקס קניון איילון', 349.7, 'אופנה');
push(isra, 2026, 8, 9, 'זארה ישראל', 529, 'אופנה');
push(isra, 2026, 8, 16, 'זארה ישראל', -149, 'אופנה', 'זיכוי');
push(isra, 2026, 9, 15, 'מוסך המרכז בע"מ', 3850, 'רכב');
push(isra, 2026, 10, 4, 'שופרסל דיל רמת גן', 1480.3, 'מזון');
push(max, 2026, 7, 12, 'טויס אר אס', 279.9, 'ילדים');
push(max, 2026, 8, 3, 'BOOKING.COM', 2950, 'תיירות');
push(max, 2026, 8, 20, 'ישרוטל אילת', 1800, 'תיירות');
push(max, 2026, 9, 6, 'חוגי ספורט מרכז קהילתי', 640, 'חינוך');
push(max, 2026, 9, 27, 'פרחי השרון', 180, 'מתנות');
// תשלומים: KSP נרכש 15/05/2026, 12 תשלומים של 299; איקאה נרכש 20/07/2026, 6 תשלומים של 400
[[8, 3], [9, 4], [10, 5]].forEach(([cm, n]) =>
  isra.push({ y: 2026, m: 5, d: 15, name: 'KSP מחשבים', orig: 3588, amount: 299, extra: `תשלום ${n} מתוך 12`, branch: 'מחשבים', charge: dmy(2026, cm, 10) }));
[[8, 1], [9, 2], [10, 3]].forEach(([cm, n]) =>
  isra.push({ y: 2026, m: 7, d: 20, name: 'איקאה נתניה', orig: 2400, amount: 400, extra: `תשלום ${n} מתוך 6`, branch: 'ריהוט', charge: dmy(2026, cm, 10) }));

const byCharge = (a, b) => a.charge.split('/').reverse().join('').localeCompare(b.charge.split('/').reverse().join('')) || (a.y - b.y) || (a.m - b.m) || (a.d - b.d);
isra.sort(byCharge); max.sort(byCharge);
const sumFor = (list, charge) => Math.round(list.filter((r) => r.charge === charge).reduce((s, r) => s + r.amount, 0) * 100) / 100;

// ---------- בנק ----------
const bank = []; // {y,m,d,desc,debit,credit}
const b = (y, m, d, desc, debit, credit = 0) => { if (LAST_DAY[m] && d > LAST_DAY[m]) return; bank.push({ y, m, d, desc, debit, credit }); };
for (const [y, m] of MONTHS) {
  b(y, m, 1, 'משכורת - טק סולושנס בע"מ', 0, 18450);
  b(y, m, 1, 'משכורת - משרד החינוך', 0, 11280);
  b(y, m, 2, 'משכנתא - לאומי למשכנתאות', 5420);
  b(y, m, 5, 'הו"ק צהרון גן שקד', 1450);
  b(y, m, 8, 'ועד בית הרצל 12', 350);
  if (m !== 7) {
    b(y, m, 10, 'ישראכרט בע"מ חיוב', sumFor(isra, dmy(y, m, 10)));
    b(y, m, 10, 'מקס איט פיננסים חיוב', sumFor(max, dmy(y, m, 10)));
  }
  if (m % 2 === 1) b(y, m, 12, 'חברת החשמל לישראל', between(480, 690));
  if (m % 2 === 0) b(y, m, 14, 'מי אביבים תאגיד מים', between(180, 260));
  if (m % 2 === 1) b(y, m, 15, 'עיריית רמת גן ארנונה', 812);
  b(y, m, 16, 'הראל חברה לביטוח', 436.5);
  b(y, m, 18, 'משיכת מזומן מבנקט', 600);
  b(y, m, 20, 'ביטוח לאומי קצבת ילדים', 0, 340);
  b(y, m, 22, 'העברה ב-BIT ליעל כהן', 200);
  b(y, m, 25, 'העברה לפיקדון חיסכון', 1500);
}
bank.sort((a, c) => (a.m - c.m) || (a.d - c.d));

let balance = 24300;
const csvCell = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const bankLines = [
  'בנק לאומי - תנועות בחשבון עובר ושב',
  'חשבון: 800-123456/78,שם: משפחת ישראלי (נתוני דוגמה)',
  'תקופה: 01/07/2026 - 05/10/2026',
  '',
  'תאריך,תאריך ערך,תיאור,אסמכתא,בחובה,בזכות,יתרה בש"ח',
];
bank.forEach((r, i) => {
  balance = Math.round((balance - r.debit + r.credit) * 100) / 100;
  bankLines.push([dmy(r.y, r.m, r.d), dmy(r.y, r.m, r.d), r.desc, String(700100 + i * 7),
    r.debit ? moneyComma(r.debit) : '', r.credit ? moneyComma(r.credit) : '', moneyComma(balance)].map(csvCell).join(','));
});
const bankCsv = '﻿' + bankLines.join('\r\n') + '\r\n';

// ---------- ישראכרט (Windows-1255) ----------
const israLines = [
  'ישראכרט - פירוט עסקאות,,,,,,',
  'כרטיס: מאסטרקארד 4580 (נתוני דוגמה),,,,,,',
  ',,,,,,',
  'תאריך רכישה,שם בית עסק,סכום עסקה,סכום חיוב,פירוט נוסף,תאריך חיוב,ענף',
  ...isra.map((r) => [dmy(r.y, r.m, r.d), r.name, money(r.orig), money(r.amount), r.extra, r.charge, r.branch].map(csvCell).join(',')),
];
const toCp1255 = (str) => Buffer.from([...str].map((ch) => {
  const c = ch.codePointAt(0);
  if (c < 0x80) return c;
  if (c >= 0x5d0 && c <= 0x5ea) return c - 0x5d0 + 0xe0;
  if (c === 0x20aa) return 0xa4;
  return 0x3f;
}));
const israBuf = toCp1255(israLines.join('\r\n') + '\r\n');

// ---------- מקס (xls שהוא בעצם טבלת HTML, כמו בייצוא של חברות אשראי) ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const maxHtml = `<html dir="rtl"><head><meta charset="utf-8"></head><body><table>
<tr><td colspan="8">max - פירוט עסקאות בכרטיס 7731 (נתוני דוגמה)</td></tr>
<tr><td colspan="8"></td></tr>
<tr><th>תאריך עסקה</th><th>שם בית העסק</th><th>קטגוריה</th><th>סכום חיוב</th><th>מטבע חיוב</th><th>סכום עסקה מקורי</th><th>הערות</th><th>תאריך חיוב</th></tr>
${max.map((r) => `<tr><td>${dmy(r.y, r.m, r.d)}</td><td>${esc(r.name)}</td><td>${esc(r.branch)}</td><td>${money(r.amount)}</td><td>₪</td><td>${money(r.orig)}</td><td>${esc(r.extra)}</td><td>${r.charge}</td></tr>`).join('\n')}
</table></body></html>`;

const out = __dirname;
fs.writeFileSync(path.join(out, 'בנק-לאומי-עוש.csv'), bankCsv, 'utf8');
fs.writeFileSync(path.join(out, 'ישראכרט-פירוט.csv'), israBuf);
fs.writeFileSync(path.join(out, 'מקס-פירוט.xls'), maxHtml, 'utf8');

// גרסה מוטמעת לכפתור "טען קבצי דוגמה" (עובד גם בפתיחה ישירה של index.html)
const b64 = (buf) => Buffer.from(buf).toString('base64');
fs.writeFileSync(path.join(out, '..', 'www', 'js', 'sample-data.js'),
  `// נוצר אוטומטית על ידי samples/generate.js\nwindow.SAMPLE_FILES = ${JSON.stringify([
    { name: 'בנק-לאומי-עוש.csv', type: 'text/csv', b64: b64(Buffer.from(bankCsv, 'utf8')) },
    { name: 'ישראכרט-פירוט.csv', type: 'text/csv', b64: b64(israBuf) },
    { name: 'מקס-פירוט.xls', type: 'application/vnd.ms-excel', b64: b64(Buffer.from(maxHtml, 'utf8')) },
  ])};\n`);
console.log(`bank ${bank.length} rows, isracard ${isra.length} rows, max ${max.length} rows`);
