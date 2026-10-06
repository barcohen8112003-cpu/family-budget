'use strict';
/* קריאת קבצים (CSV / Excel / PDF), זיהוי עמודות ונרמול שורות לעסקאות */

class ImportError extends Error {}

const FIELD_LABELS = {
  date: 'תאריך', description: 'תיאור / בית עסק', amount: 'סכום', debit: 'חובה', credit: 'זכות',
  balance: 'יתרה', chargeDate: 'תאריך חיוב', originalAmount: 'סכום עסקה מקורי', details: 'פירוט / תשלומים',
};
// סדר הזיהוי חשוב: שדות ספציפיים לפני כלליים
const FIELD_SYNONYMS = [
  ['chargeDate', ['תאריך חיוב', 'תאריך החיוב', 'מועד חיוב']],
  ['originalAmount', ['סכום עסקה מקורי', 'סכום העסקה', 'סכום עסקה', 'סכום מקורי']],
  ['details', ['פירוט נוסף', 'פרטים נוספים', 'הערות', 'פירוט', 'תשלומים']],
  ['balance', ['יתרה בש"ח', 'יתרה', 'balance']],
  ['debit', ['בחובה', 'חובה', 'debit']],
  ['credit', ['בזכות', 'זכות', 'credit']],
  ['date', ['תאריך עסקה', 'תאריך רכישה', 'תאריך פעולה', 'תאריך', 'date']],
  ['description', ['שם בית העסק', 'שם בית עסק', 'בית עסק', 'שם העסק', 'תיאור פעולה', 'תיאור התנועה', 'תיאור', 'פרטים', 'הפעולה', 'פעולה', 'description']],
  ['amount', ['סכום חיוב', 'סכום לחיוב', 'סכום החיוב', 'סכום בש"ח', 'סכום', 'amount']],
];

const Parsers = {
  cleanCell(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v.replace(/[‎‏‪-‮﻿]/g, '').replace(/\s+/g, ' ').trim();
    return v;
  },
  normHeader: (v) => String(Parsers.cleanCell(v)).toLowerCase().replace(/[״''`]/g, '"').replace(/[₪:*]/g, '').trim(),

  parseDate(v) {
    if (v instanceof Date && !isNaN(v)) return U.iso(v);
    if (typeof v === 'number' && v > 20000 && v < 80000) { // מספר סידורי של Excel
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5);
      return `${d.getUTCFullYear()}-${U.pad(d.getUTCMonth() + 1)}-${U.pad(d.getUTCDate())}`;
    }
    const s = String(Parsers.cleanCell(v));
    let m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})(?!\d)/);
    let y, mo, d;
    if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
    else if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else return null;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
    return `${y}-${U.pad(mo)}-${U.pad(d)}`;
  },
  parseAmount(v) {
    if (typeof v === 'number') return v;
    let s = String(Parsers.cleanCell(v)).replace(/₪|ש"ח|ש״ח|nis|ils/gi, '').replace(/[\s,]/g, '').replace(/[−–]/g, '-');
    if (!s) return NaN;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
    if (s.startsWith('-')) { neg = !neg; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
    if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
    return neg ? -parseFloat(s) : parseFloat(s);
  },
  parseInstallment(text) {
    const m = String(text).match(/תשלום\s*(\d{1,2})\s*מתוך\s*(\d{1,2})/) || String(text).match(/(\d{1,2})\s*מתוך\s*(\d{1,2})/) || String(text).match(/(\d{1,2})\s*מ-\s*(\d{1,2})/);
    if (!m) return null;
    const n = +m[1], total = +m[2];
    return n >= 1 && total >= 2 && n <= total ? { n, total } : null;
  },

  // ---------- קריאת קובץ לטבלת תאים ----------
  decodeText(buf) {
    const u8 = new Uint8Array(buf);
    if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(u8.subarray(3)), encoding: 'UTF-8' };
    if (u8[0] === 0xff && u8[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(u8.subarray(2)), encoding: 'UTF-16' };
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), encoding: 'UTF-8' }; }
    catch (e) { return { text: new TextDecoder('windows-1255').decode(u8), encoding: 'Windows-1255' }; }
  },
  async readFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['csv', 'txt', 'xls', 'xlsx', 'pdf'].includes(ext)) throw new ImportError(`סוג הקובץ "${ext}" אינו נתמך. אפשר לייבא קובצי Excel (xlsx, xls), CSV או PDF.`);
    if (file.size === 0) throw new ImportError('הקובץ ריק.');
    if (file.size > 25 * 1024 * 1024) throw new ImportError('הקובץ גדול מדי (מעל 25MB).');
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    const isZip = u8[0] === 0x50 && u8[1] === 0x4b, isOle = u8[0] === 0xd0 && u8[1] === 0xcf, isPdf = u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46;
    let grid, info = '';
    if (isPdf || ext === 'pdf') {
      if (!isPdf) throw new ImportError('הקובץ אינו קובץ PDF תקין.');
      grid = await Parsers.readPdf(buf); info = 'PDF';
    } else if (isZip || isOle) {
      grid = Parsers.readWorkbook(XLSX.read(u8, { type: 'array', codepage: 1255 })); info = 'Excel';
    } else {
      const { text, encoding } = Parsers.decodeText(buf);
      if (/^\s*(<\?xml|<html|<!doctype|<table|<meta)/i.test(text.slice(0, 500))) { // "xls" שהוא טבלת HTML
        grid = Parsers.readWorkbook(XLSX.read(text, { type: 'string', raw: true })); info = `Excel (HTML), ${encoding}`;
      } else {
        grid = Parsers.readCsv(text); info = `CSV, ${encoding}`;
      }
    }
    grid = grid.map((r) => r.map(Parsers.cleanCell)).filter((r) => r.some((c) => c !== ''));
    if (!grid.length) throw new ImportError('לא נמצאו נתונים בקובץ.');
    return { grid, info };
  },
  readWorkbook(wb) {
    let best = [];
    wb.SheetNames.forEach((n) => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
      if (rows.length > best.length) best = rows;
    });
    return best;
  },
  readCsv(text) {
    const head = text.slice(0, 5000);
    const delimiter = [',', '\t', ';', '|'].map((d) => [d, head.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const res = Papa.parse(text, { delimiter, skipEmptyLines: true });
    return res.data;
  },
  async readPdf(buf) {
    if (!window.pdfjsLib) throw new ImportError('רכיב קריאת ה-PDF לא נטען. בדקו את החיבור לאינטרנט ונסו שוב.');
    let pdf;
    try { pdf = await pdfjsLib.getDocument({ data: buf }).promise; }
    catch (e) { throw new ImportError(e && e.name === 'PasswordException' ? 'קובץ ה-PDF מוגן בסיסמה. הסירו את ההגנה ונסו שוב.' : 'לא ניתן לקרוא את קובץ ה-PDF.'); }
    const lines = []; // כל שורה: רשימת תאים {x1, x2, str}
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const rows = {};
      content.items.forEach((it) => {
        if (!it.str || !it.str.trim()) return;
        const y = Math.round(it.transform[5] / 3) * 3;
        (rows[y] = rows[y] || []).push({ x1: it.transform[4], x2: it.transform[4] + it.width, str: it.str.trim() });
      });
      Object.keys(rows).map(Number).sort((a, b) => b - a).forEach((y) => {
        const items = rows[y].sort((a, b) => b.x1 - a.x1); // מימין לשמאל
        const cells = [];
        items.forEach((it) => {
          const last = cells[cells.length - 1];
          if (last && last.x1 - it.x2 < 7) { last.str = `${last.str} ${it.str}`; last.x1 = it.x1; } else cells.push({ ...it });
        });
        lines.push(cells);
      });
    }
    if (!lines.length) throw new ImportError('לא נמצא טקסט ב-PDF. ייתכן שזה קובץ סרוק (תמונה), שאי אפשר לחלץ ממנו טבלה.');
    // יישור לעמודות לפי מיקום תאי שורת הכותרת
    const tryAlign = (ls) => {
      const strRows = ls.map((cells) => cells.map((c) => c.str));
      const hdr = Parsers.findHeader(strRows);
      if (!hdr) return null;
      const anchors = ls[hdr.row].map((c) => (c.x1 + c.x2) / 2);
      return ls.map((cells, i) => {
        if (i < hdr.row) return cells.map((c) => c.str);
        const out = anchors.map(() => '');
        cells.forEach((c) => {
          const mid = (c.x1 + c.x2) / 2; let k = 0;
          anchors.forEach((a, j) => { if (Math.abs(a - mid) < Math.abs(anchors[k] - mid)) k = j; });
          out[k] = out[k] ? `${out[k]} ${c.str}` : c.str;
        });
        return out;
      });
    };
    // יש קובצי PDF שבהם העברית שמורה בסדר חזותי (הפוך)
    const flip = (s) => (/[א-ת]/.test(s) ? [...s].reverse().join('').replace(/[\d.,/\-:]+|[a-zA-Z]+/g, (m) => [...m].reverse().join('')) : s);
    return tryAlign(lines) || tryAlign(lines.map((cells) => cells.map((c) => ({ ...c, str: flip(c.str) })))) || lines.map((cells) => cells.map((c) => c.str));
  },

  // ---------- זיהוי כותרת ועמודות ----------
  matchHeaders(headers) {
    const norm = headers.map(Parsers.normHeader);
    const map = {}; const taken = new Set();
    const pass = (test) => FIELD_SYNONYMS.forEach(([field, syns]) => {
      if (map[field] !== undefined) return;
      for (const syn of syns) {
        const idx = norm.findIndex((h, i) => !taken.has(i) && h && test(h, syn));
        if (idx >= 0) { map[field] = idx; taken.add(idx); return; }
      }
    });
    pass((h, syn) => h === syn);
    pass((h, syn) => h.includes(syn));
    return map;
  },
  findHeader(grid) {
    let best = null;
    grid.slice(0, 40).forEach((row, i) => {
      const map = Parsers.matchHeaders(row); const score = Object.keys(map).length;
      if (score >= 2 && map.date !== undefined && (!best || score > best.score)) best = { row: i, map, score };
    });
    return best;
  },
  detect(grid, fileName) {
    const hdr = Parsers.findHeader(grid);
    const headerRow = hdr ? hdr.row : Parsers.guessHeaderRow(grid);
    const headers = (grid[headerRow] || []).map((h) => String(h));
    const mapping = hdr ? { ...hdr.map } : {};
    if (mapping.amount === undefined && mapping.originalAmount !== undefined && mapping.debit === undefined) { mapping.amount = mapping.originalAmount; delete mapping.originalAmount; }
    // זיהוי מקור: שם הקובץ והשורות שלפני הכותרת
    const pre = `${fileName} ${grid.slice(0, Math.min(headerRow, 10)).map((r) => r.join(' ')).join(' ')}`;
    const cc = CC_COMPANIES.find((c) => c.re.test(pre)); const bank = cc ? null : BANKS.find((b) => b.re.test(pre));
    const institution = cc ? cc.id : bank ? bank.id : null;
    const looksCredit = mapping.chargeDate !== undefined || /בית ה?עסק/.test(headers.join(' '));
    const looksBank = mapping.debit !== undefined || mapping.balance !== undefined;
    const sourceType = cc ? 'credit' : bank ? 'bank' : looksCredit && !looksBank ? 'credit' : 'bank';
    const signature = U.hash(`${institution || '?'}|${headers.map(Parsers.normHeader).join('|')}`);
    const saved = S.mappings[signature];
    let confident = Parsers.isComplete(mapping) && Parsers.sampleOk(grid, headerRow, mapping);
    let usedSaved = false;
    if (saved) { Object.keys(mapping).forEach((k) => delete mapping[k]); Object.assign(mapping, saved.mapping); confident = true; usedSaved = true; }
    return { headerRow, headers, mapping, confident, usedSaved, institution, sourceType, signature,
      institutionName: (cc || bank || {}).name || null };
  },
  // כשאין כותרת מזוהה: השורה הראשונה שיש בה לפחות 3 תאים מלאים
  guessHeaderRow(grid) { const i = grid.findIndex((r) => r.filter((c) => c !== '').length >= 3); return i < 0 ? 0 : i; },
  isComplete: (m) => m.date !== undefined && m.description !== undefined && (m.amount !== undefined || m.debit !== undefined || m.credit !== undefined),
  sampleOk(grid, headerRow, m) {
    const sample = grid.slice(headerRow + 1, headerRow + 9).filter((r) => r[m.date] !== '' && r[m.date] !== undefined);
    if (!sample.length) return false;
    return sample.filter((r) => Parsers.parseDate(r[m.date])).length / sample.length >= 0.75;
  },

  // ---------- נרמול ----------
  normalize(grid, det, sourceType) {
    const m = det.mapping; const rows = []; let skipped = 0;
    if (!Parsers.isComplete(m)) throw new ImportError('חסרות עמודות חובה: תאריך, תיאור וסכום (או חובה/זכות). השלימו את המיפוי.');
    for (let i = det.headerRow + 1; i < grid.length; i++) {
      const r = grid[i]; const cell = (f) => (m[f] === undefined ? '' : r[m[f]] ?? '');
      const rawDate = Parsers.parseDate(cell('date'));
      const description = String(cell('description')).trim();
      let amount;
      if (m.debit !== undefined || m.credit !== undefined) {
        const d = Parsers.parseAmount(cell('debit')), c = Parsers.parseAmount(cell('credit'));
        amount = (isNaN(c) ? 0 : Math.abs(c)) - (isNaN(d) ? 0 : Math.abs(d));
        if (isNaN(c) && isNaN(d)) amount = NaN;
      } else {
        amount = Parsers.parseAmount(cell('amount'));
        if (sourceType === 'credit') amount = -amount; // בתדפיס אשראי סכום חיובי הוא הוצאה
      }
      if (!rawDate || !description || isNaN(amount) || amount === 0) { skipped++; continue; }
      amount = U.round(amount);
      const details = String(cell('details')).trim();
      const installment = Parsers.parseInstallment(`${details} ${description}`);
      const chargeDate = Parsers.parseDate(cell('chargeDate'));
      const orig = Parsers.parseAmount(cell('originalAmount'));
      const balance = Parsers.parseAmount(cell('balance'));
      // בעסקת תשלומים התאריך בתדפיס הוא מועד הרכישה; החיוב בפועל נרשם בחודש החיוב
      const date = installment ? (chargeDate || U.addMonths(rawDate, installment.n - 1)) : rawDate;
      rows.push({
        date, purchaseDate: rawDate, chargeDate: chargeDate || null, description, merchant: Classify.merchantKey(description), amount,
        originalAmount: isNaN(orig) ? null : Math.abs(orig), installment, details, balance: isNaN(balance) ? null : balance, row: i + 1,
      });
    }
    return { rows, skipped };
  },
};
