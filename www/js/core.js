'use strict';
/* ליבה: כלי עזר, IndexedDB, מצב האפליקציה, קטגוריות, סיווג וחישובים */

// ---------- כלי עזר ----------
const U = {
  uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9),
  round: (n) => Math.round(n * 100) / 100,
  pad: (n) => String(n).padStart(2, '0'),
  iso: (d) => `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())}`,
  today: () => U.iso(new Date()),
  toDate: (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); },
  il: (iso) => (iso ? iso.split('-').reverse().join('/') : ''),
  ym: (iso) => iso.slice(0, 7),
  addMonths(iso, n) {
    const d = U.toDate(iso); const day = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return U.iso(d);
  },
  addDays(iso, n) { const d = U.toDate(iso); d.setDate(d.getDate() + n); return U.iso(d); },
  daysBetween: (a, b) => Math.round((U.toDate(b) - U.toDate(a)) / 864e5),
  ymAdd(ym, n) { return U.addMonths(ym + '-01', n).slice(0, 7); },
  monthName(ym) {
    const names = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    const [y, m] = ym.split('-').map(Number); return `${names[m - 1]} ${y}`;
  },
  daysInMonth(ym) { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); },
  nf: new Intl.NumberFormat('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
  // סכום לתצוגה. signed=true מוסיף + או −
  money(n, signed = false) {
    const abs = U.nf.format(Math.abs(U.round(n)));
    const sign = n < 0 ? '−' : signed && n > 0 ? '+' : '';
    return `${sign}${abs} ₪`;
  },
  median(a) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; },
  sum: (a, f = (x) => x) => U.round(a.reduce((s, x) => s + f(x), 0)),
  esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  async sha(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  },
  hash(str) { // גיבוב קצר ודטרמיניסטי לזיהוי כפילויות
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
  },
};

// ---------- IndexedDB ----------
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const req = indexedDB.open('family-budget', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('tx')) db.createObjectStore('tx', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      };
      req.onsuccess = () => { DB.db = req.result; res(); };
      req.onerror = () => rej(new Error('לא ניתן לפתוח את מאגר הנתונים המקומי. ייתכן שהדפדפן במצב גלישה פרטית.'));
    });
  },
  run(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = DB.db.transaction(store, mode); const out = fn(t.objectStore(store));
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
      t.onerror = () => rej(t.error);
    });
  },
  all: (store) => DB.run(store, 'readonly', (s) => s.getAll()),
  put: (store, items) => DB.run(store, 'readwrite', (s) => { (Array.isArray(items) ? items : [items]).forEach((i) => s.put(i)); }),
  del: (store, ids) => DB.run(store, 'readwrite', (s) => { (Array.isArray(ids) ? ids : [ids]).forEach((i) => s.delete(i)); }),
  clear: (store) => DB.run(store, 'readwrite', (s) => { s.clear(); }),
};

// ---------- ברירות מחדל ----------
// type: expense | income | system
const DEFAULT_CATEGORIES = [
  { id: 'food', name: 'מזון וסופר', color: '#2a7448', icon: 'shopping-cart' },
  { id: 'housing', name: 'דיור ושכר דירה/משכנתא', color: '#0f5c57', icon: 'house' },
  { id: 'housing-rent', name: 'שכר דירה', parentId: 'housing' },
  { id: 'housing-mortgage', name: 'משכנתא', parentId: 'housing' },
  { id: 'bills', name: 'חשבונות', color: '#c98a12', icon: 'receipt' },
  { id: 'bills-electric', name: 'חשמל', parentId: 'bills' },
  { id: 'bills-water', name: 'מים', parentId: 'bills' },
  { id: 'bills-arnona', name: 'ארנונה', parentId: 'bills' },
  { id: 'bills-gas', name: 'גז', parentId: 'bills' },
  { id: 'telecom', name: 'תקשורת', color: '#1a6aa8', icon: 'wifi' },
  { id: 'car', name: 'רכב ודלק', color: '#6b5b95', icon: 'car' },
  { id: 'transit', name: 'תחבורה ציבורית', color: '#3d8fb5', icon: 'bus' },
  { id: 'health', name: 'בריאות', color: '#c2456b', icon: 'heart-pulse' },
  { id: 'insurance', name: 'ביטוחים', color: '#56677a', icon: 'shield' },
  { id: 'education', name: 'חינוך וחוגים', color: '#8a6d1f', icon: 'graduation-cap' },
  { id: 'kids', name: 'ילדים', color: '#d9773c', icon: 'baby' },
  { id: 'clothing', name: 'ביגוד', color: '#a2559c', icon: 'shirt' },
  { id: 'dining', name: 'מסעדות ובילויים', color: '#b3401f', icon: 'utensils' },
  { id: 'subs', name: 'מנויים', color: '#4f6bd6', icon: 'repeat' },
  { id: 'online', name: 'קניות אונליין', color: '#2f8f8a', icon: 'package' },
  { id: 'vacation', name: 'חופשות', color: '#e8a33d', icon: 'plane' },
  { id: 'gifts', name: 'מתנות', color: '#d0527c', icon: 'gift' },
  { id: 'transfers', name: 'העברות', color: '#7a7f85', icon: 'arrow-left-right' },
  { id: 'income', name: 'הכנסות', color: '#1a6aa8', icon: 'wallet', type: 'income' },
  { id: 'income-salary', name: 'משכורת', parentId: 'income', type: 'income' },
  { id: 'income-benefits', name: 'קצבאות', parentId: 'income', type: 'income' },
  { id: 'other', name: 'אחר', color: '#8a857b', icon: 'circle-ellipsis' },
  { id: 'cc', name: 'חיוב כרטיס אשראי', color: '#5a626a', icon: 'credit-card', type: 'system' },
].map((c) => ({ type: 'expense', ...c }));

// מילון בתי עסק: [מילות מפתח, קטגוריה]. ההתאמה לפי הכלה, אחרי נרמול.
const MERCHANT_DICT = [
  [['משכורת', 'שכר עבודה'], 'income-salary'],
  [['קצבת', 'ביטוח לאומי', 'ב.לאומי', 'מענק'], 'income-benefits'],
  [['מכבי', 'כללית', 'מאוחדת', 'לאומית שירותי', 'סופר-פארם', 'סופר פארם', 'בית מרקחת', 'רופא', 'מרפאת', 'אופטיק', 'שיניים', 'be פארם'], 'health'],
  [['שופרסל', 'רמי לוי', 'ויקטורי', 'יוחננוף', 'אושר עד', 'טיב טעם', 'מגה', 'יינות ביתן', 'חצי חינם', 'סופר', 'מחסני השוק', 'am:pm', 'קרפור', 'מאפיית', 'מעדני'], 'food'],
  [['משכנתא', 'למשכנתאות'], 'housing-mortgage'],
  [['שכר דירה', 'שכירות', 'ועד בית'], 'housing'],
  [['חברת החשמל', 'חשמל'], 'bills-electric'],
  [['מי אביבים', 'תאגיד מים', 'מקורות', 'הגיחון', 'מי שבע', 'מי רמת'], 'bills-water'],
  [['ארנונה', 'עיריית', 'עירית', 'מועצה מקומית'], 'bills-arnona'],
  [['פזגז', 'אמישראגז', 'סופרגז', 'גז '], 'bills-gas'],
  [['בזק', 'פרטנר', 'סלקום', 'פלאפון', 'hot', 'הוט', 'yes', 'גולן טלקום', '019', '012', 'רמי לוי תקשורת', 'we4g'], 'telecom'],
  [['פז', 'סונול', 'דלק', 'דור אלון', 'yellow', 'יילו', 'מוסך', 'פנגו', 'סלופארק', 'חניון', 'חניה', 'כביש 6', 'נתיבי איילון', 'רישוי', 'טסט'], 'car'],
  [['רב-קו', 'רב קו', 'רכבת ישראל', 'אגד', 'דן תחבורה', 'מטרופולין', 'קווים', 'gett', 'גט טקסי', 'מונית', 'moovit'], 'transit'],
  [['ביטוח', 'הראל', 'מגדל', 'הפניקס', 'מנורה', 'איילון חברה', 'aig', 'ליברה', 'ביטוח ישיר'], 'insurance'],
  [['צהרון', 'גן ילדים', 'גנון', 'מעון', 'חוג', 'בית ספר', 'אוניברסיט', 'מכללת', 'שכר לימוד', 'מתנ"ס', 'מרכז קהילתי'], 'education'],
  [['טויס', 'צעצוע', 'שילב', 'מוצצים', 'בייבי'], 'kids'],
  [['זארה', 'zara', 'h&m', 'פוקס', 'קסטרו', 'רנואר', 'גולף', 'טרמינל x', 'terminal x', 'נעלי', 'אמריקן איגל', 'דלתא', 'shein'], 'clothing'],
  [['ארומה', 'מקדונלד', 'בורגר', 'פיצה', 'wolt', 'וולט', 'תן ביס', '10bis', 'קפה', 'מסעד', 'גולדה', 'ג\'פניקה', 'סושי', 'קולנוע', 'סינמה', 'יס פלאנט', 'פאב', 'לנדוור', 'גרג'], 'dining'],
  [['נטפליקס', 'netflix', 'ספוטיפיי', 'spotify', 'apple.com', 'google', 'disney', 'youtube', 'הולמס פלייס', 'חדר כושר', 'icloud', 'amazon prime', 'chatgpt', 'openai', 'microsoft', 'dropbox'], 'subs'],
  [['amazon', 'אמזון', 'aliexpress', 'עלי אקספרס', 'ebay', 'ksp', 'איביי', 'zap', 'temu', 'איקאה', 'ikea', 'סטימצקי', 'צומת ספרים'], 'online'],
  [['booking', 'airbnb', 'אל על', 'ישראייר', 'ארקיע', 'ישרוטל', 'פתאל', 'מלון', 'דן אכסניות', 'איסתא', 'hotels', 'wizz', 'ryanair'], 'vacation'],
  [['פרחי', 'מתנה', 'מתנות', 'buyme', 'ביי מי'], 'gifts'],
  [['העברה', 'bit ', 'ביט ', 'paybox', 'פייבוקס', 'משיכת מזומן', 'משיכה מבנקט', 'בנקט', 'כספומט', 'פיקדון', 'הפקדה'], 'transfers'],
];

// זיהוי שורת חיוב כרטיס אשראי בתדפיס הבנק
const CC_COMPANIES = [
  { id: 'isracard', name: 'ישראכרט', re: /ישראכרט|isracard/i },
  { id: 'cal', name: 'כאל', re: /(?<![א-ת])כאל(?![א-ת])|כ\.א\.ל|\bcal\b|כרטיסי אשראי לישראל/i },
  { id: 'max', name: 'מקס', re: /(?<![א-ת])מקס(?![א-ת])|\bmax\b|לאומי קארד/i },
  { id: 'amex', name: 'אמריקן אקספרס', re: /אמריקן אקספרס|אמקס|american express|amex/i },
];
const BANKS = [
  { id: 'leumi', name: 'בנק לאומי', re: /לאומי|leumi/i },
  { id: 'poalim', name: 'בנק הפועלים', re: /הפועלים|פועלים|poalim/i },
  { id: 'discount', name: 'בנק דיסקונט', re: /דיסקונט|discount/i },
  { id: 'mizrahi', name: 'מזרחי-טפחות', re: /מזרחי|טפחות|mizrahi/i },
  { id: 'fibi', name: 'הבינלאומי', re: /הבינלאומי|בינלאומי|fibi/i },
];

// ---------- מצב ----------
const S = {
  tx: [],
  categories: [], rules: {}, mappings: {}, budgets: {}, goals: [], filters: [], sources: [],
  settings: { theme: 'auto', pinHash: null, members: ['משותף'] },
};
const KV_KEYS = ['categories', 'rules', 'mappings', 'budgets', 'goals', 'filters', 'sources', 'settings'];

const Store = {
  async load() {
    await DB.open();
    S.tx = await DB.all('tx');
    const kv = await DB.all('kv');
    kv.forEach((r) => { if (KV_KEYS.includes(r.key)) S[r.key] = r.value; });
    if (!S.categories.length) { S.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)); await Store.save('categories'); }
    if (!S.categories.find((c) => c.id === 'cc')) S.categories.push(DEFAULT_CATEGORIES.find((c) => c.id === 'cc'));
    S.settings = { theme: 'auto', pinHash: null, members: ['משותף'], ...S.settings };
    Calc.relink();
  },
  save: (key) => DB.put('kv', { key, value: S[key] }),
  async putTx(list) {
    list = Array.isArray(list) ? list : [list];
    const ids = new Set(list.map((t) => t.id));
    S.tx = S.tx.filter((t) => !ids.has(t.id)).concat(list);
    await DB.put('tx', list);
    const changed = Calc.relink();
    if (changed.length) await DB.put('tx', changed);
  },
  async delTx(ids) {
    ids = Array.isArray(ids) ? ids : [ids];
    const set = new Set(ids);
    S.tx = S.tx.filter((t) => !set.has(t.id));
    await DB.del('tx', ids);
    const changed = Calc.relink();
    if (changed.length) await DB.put('tx', changed);
  },
  async wipe() {
    await DB.clear('tx'); await DB.clear('kv');
    S.tx = []; S.rules = {}; S.mappings = {}; S.budgets = {}; S.goals = []; S.filters = []; S.sources = [];
    S.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    S.settings = { theme: S.settings.theme, pinHash: null, members: ['משותף'] };
    await Store.save('categories'); await Store.save('settings');
  },
  exportAll() {
    const out = { app: 'family-budget', version: 1, exportedAt: new Date().toISOString(), tx: S.tx };
    KV_KEYS.forEach((k) => { out[k] = S[k]; });
    return out;
  },
  async importAll(data) {
    if (!data || data.app !== 'family-budget' || !Array.isArray(data.tx)) throw new Error('הקובץ אינו קובץ גיבוי של האפליקציה.');
    await DB.clear('tx'); await DB.clear('kv');
    S.tx = data.tx;
    await DB.put('tx', S.tx);
    for (const k of KV_KEYS) { if (data[k] !== undefined) { S[k] = data[k]; await Store.save(k); } }
    Calc.relink();
  },
};

// ---------- קטגוריות וסיווג ----------
const Cat = {
  get: (id) => S.categories.find((c) => c.id === id) || S.categories.find((c) => c.id === 'other'),
  top(id) { const c = Cat.get(id); return c.parentId ? Cat.get(c.parentId) : c; },
  label(id) { const c = Cat.get(id); return c.parentId ? `${Cat.get(c.parentId).name} › ${c.name}` : c.name; },
  color: (id) => Cat.top(id).color || '#8a857b',
  icon: (id) => Cat.top(id).icon || 'circle',
  isIncome: (id) => Cat.get(id).type === 'income',
  tops: () => S.categories.filter((c) => !c.parentId),
  children: (id) => S.categories.filter((c) => c.parentId === id),
  // רשימה שטוחה לבחירה: ראשיות ומתחתן תתי-קטגוריות
  options(includeSystem = false) {
    const out = [];
    Cat.tops().forEach((c) => {
      if (c.type === 'system' && !includeSystem) return;
      out.push({ id: c.id, label: c.name });
      Cat.children(c.id).forEach((s) => out.push({ id: s.id, label: `— ${s.name}` }));
    });
    return out;
  },
  // כל המזהים שנכללים בקטגוריה (היא ותתי-הקטגוריות שלה)
  family: (id) => [id, ...Cat.children(id).map((c) => c.id)],
};

const Classify = {
  // מפתח בית עסק: בלי מספרים, סימני פיסוק ופירוט תשלומים
  merchantKey(desc) {
    return String(desc || '').toLowerCase()
      .replace(/תשלום\s*\d+\s*מתוך\s*\d+/g, ' ')
      .replace(/["'`״׳.,\-_/\\()*#:]/g, ' ')
      .replace(/\b\d{3,}\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
  },
  // מילת מפתח נחשבת רק בתחילת מילה, כדי ש'יילו' לא יתאים ל'איילון'
  _re: {},
  wordRe(w) { return Classify._re[w] || (Classify._re[w] = new RegExp('(^|[^a-z0-9א-ת])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); },
  category(desc, amount, sourceType) {
    const key = Classify.merchantKey(desc);
    if (S.rules[key]) return S.rules[key];
    const hay = ` ${String(desc).toLowerCase()} `;
    for (const [words, cat] of MERCHANT_DICT) {
      if (words.some((w) => Classify.wordRe(w).test(hay))) {
        if (Cat.isIncome(cat) && amount < 0) continue;
        if (S.categories.find((c) => c.id === cat)) return cat;
      }
    }
    if (amount > 0 && sourceType !== 'credit') return 'income';
    return 'other';
  },
  ccCompany(desc) { const c = CC_COMPANIES.find((x) => x.re.test(desc)); return c ? c.id : null; },
};

// ---------- חישובים ----------
const Calc = {
  source: (id) => S.sources.find((s) => s.id === id),
  // קישור שורות חיוב אשראי בבנק לפירוט מתדפיס האשראי. מחזיר עסקאות שהשתנו.
  relink() {
    const changed = [];
    const credit = S.tx.filter((t) => { const s = Calc.source(t.sourceId); return s && s.type === 'credit'; });
    S.tx.forEach((t) => {
      if (!t.ccCharge) return;
      const cands = credit.filter((c) => Calc.source(c.sourceId).institution === t.ccCharge);
      let match = cands.filter((c) => c.chargeDate && Math.abs(U.daysBetween(c.chargeDate, t.date)) <= 4);
      if (!match.length) match = cands.filter((c) => !c.chargeDate && c.date < t.date && U.daysBetween(c.date, t.date) <= 40);
      const linked = match.length > 0;
      const info = linked ? { count: match.length, sum: U.sum(match, (c) => -c.amount) } : null;
      if (t.linked !== linked || JSON.stringify(t.linkInfo || null) !== JSON.stringify(info)) {
        t.linked = linked; t.linkInfo = info; changed.push(t);
      }
    });
    return changed;
  },
  // האם העסקה נספרת בסיכומים (שורת חיוב אשראי מקושרת אינה נספרת)
  counts: (t) => !(t.ccCharge && t.linked),
  // חלוקת העסקה לקטגוריות (פיצול או קטגוריה אחת)
  allocations: (t) => (t.splits && t.splits.length ? t.splits : [{ categoryId: t.categoryId, amount: t.amount }]),
  // סיכום רשימת עסקאות: הכנסות, הוצאות (חיובי), לפי קטגוריה ראשית
  totals(list) {
    let income = 0, expense = 0; const byCat = {};
    list.forEach((t) => {
      if (!Calc.counts(t)) return;
      Calc.allocations(t).forEach((a) => {
        if (Cat.isIncome(a.categoryId)) income += a.amount;
        else { expense -= a.amount; const top = Cat.top(a.categoryId).id; byCat[top] = (byCat[top] || 0) - a.amount; }
      });
    });
    Object.keys(byCat).forEach((k) => { byCat[k] = U.round(byCat[k]); });
    return { income: U.round(income), expense: U.round(expense), balance: U.round(income - expense), byCat };
  },
  inMonth: (ym) => S.tx.filter((t) => t.date.startsWith(ym)),
  inRange: (from, to) => S.tx.filter((t) => t.date >= from && t.date <= to),
  months() { return [...new Set(S.tx.map((t) => U.ym(t.date)))].sort(); },
  latestMonth() { const m = Calc.months(); const now = U.today().slice(0, 7); return m.includes(now) || !m.length ? now : m[m.length - 1]; },
  expenseOf: (t) => (Calc.counts(t) ? -U.sum(Calc.allocations(t).filter((a) => !Cat.isIncome(a.categoryId)), (a) => a.amount) : 0),

  // הוצאות קבועות ומנויים: אותו בית עסק ב-3 חודשים שונים לפחות (או 2 מתוך 3 האחרונים) בסכום דומה
  recurring() {
    const groups = {};
    S.tx.forEach((t) => {
      if (t.amount >= 0 || t.installment || !Calc.counts(t) || t.ccCharge) return;
      (groups[t.merchant] = groups[t.merchant] || []).push(t);
    });
    const months = Calc.months(); const last3 = months.slice(-3);
    const out = [];
    Object.values(groups).forEach((list) => {
      const byMonth = {};
      list.forEach((t) => { byMonth[U.ym(t.date)] = (byMonth[U.ym(t.date)] || 0) - t.amount; });
      const ms = Object.keys(byMonth).sort();
      const recent = ms.filter((m) => last3.includes(m)).length;
      if (ms.length < 3 && !(ms.length === 2 && recent === 2 && months.length <= 3)) return;
      const amounts = ms.map((m) => byMonth[m]); const med = U.median(amounts);
      const perMonth = list.length / ms.length;
      if (perMonth > 1.5) return; // קניות חוזרות (סופר, דלק) אינן חיוב קבוע
      if (amounts.some((a) => Math.abs(a - med) > Math.max(med * 0.1, 5))) return;
      const lastTx = list.reduce((a, b) => (a.date > b.date ? a : b));
      out.push({ merchant: lastTx.merchant, name: lastTx.description, categoryId: lastTx.categoryId, monthly: U.round(med), yearly: U.round(med * 12),
        day: U.toDate(lastTx.date).getDate(), lastDate: lastTx.date, months: ms.length, sourceId: lastTx.sourceId });
    });
    return out.sort((a, b) => b.monthly - a.monthly);
  },
  // עסקאות בתשלומים פעילות: התשלום האחרון שנרשם לכל עסקה
  installments() {
    const groups = {};
    S.tx.forEach((t) => {
      if (!t.installment) return;
      const k = `${t.sourceId}|${t.merchant}|${t.purchaseDate || ''}|${t.installment.total}`;
      if (!groups[k] || groups[k].installment.n < t.installment.n) groups[k] = t;
    });
    return Object.values(groups).map((t) => {
      const left = t.installment.total - t.installment.n;
      return { tx: t, left, remaining: U.round(left * -t.amount), monthly: -t.amount };
    }).filter((x) => x.left > 0);
  },
  // חיובים צפויים בחודשים הבאים
  upcoming(fromYm, count = 6) {
    const months = Array.from({ length: count }, (_, i) => U.ymAdd(fromYm, i + 1));
    const rows = months.map((ym) => ({ ym, items: [], total: 0 }));
    Calc.installments().forEach((x) => {
      for (let i = 1; i <= x.left; i++) {
        const ym = U.ymAdd(U.ym(x.tx.date), i); const row = rows.find((r) => r.ym === ym);
        if (row) row.items.push({ name: x.tx.description, amount: x.monthly, kind: `תשלום ${x.tx.installment.n + i} מתוך ${x.tx.installment.total}`, categoryId: x.tx.categoryId });
      }
    });
    Calc.recurring().forEach((r) => rows.forEach((row) => { if (row.ym > U.ym(r.lastDate)) row.items.push({ name: r.name, amount: r.monthly, kind: 'הוצאה קבועה', categoryId: r.categoryId }); }));
    rows.forEach((r) => { r.total = U.sum(r.items, (i) => i.amount); r.items.sort((a, b) => b.amount - a.amount); });
    return rows;
  },
  // חריגות בחודש: הוצאה גבוהה מהרגיל או בית עסק חדש
  anomalies(ym) {
    const before = S.tx.filter((t) => U.ym(t.date) < ym && t.amount < 0 && Calc.counts(t));
    if (!before.length) return [];
    const hist = {};
    before.forEach((t) => (hist[t.merchant] = hist[t.merchant] || []).push(-t.amount));
    const out = [];
    Calc.inMonth(ym).forEach((t) => {
      if (t.amount >= 0 || !Calc.counts(t) || t.ccCharge) return;
      const h = hist[t.merchant]; const amt = -t.amount;
      if (!h) { if (amt >= 150 && !t.installment) out.push({ tx: t, type: 'new', text: 'חיוב ראשון מבית עסק שלא הופיע בעבר' }); return; }
      const med = U.median(h);
      if (h.length >= 2 && amt > med * 2 && amt - med > 100) out.push({ tx: t, type: 'high', text: `גבוה פי ${(amt / med).toFixed(1)} מהרגיל (${U.money(med)})` });
    });
    return out.sort((a, b) => a.tx.amount - b.tx.amount);
  },
  // תחזית לסוף החודש: קבועות שעוד לא חויבו + קצב ההוצאה המשתנה
  forecast(ym) {
    const today = U.today(); if (U.ym(today) !== ym) return null;
    const day = U.toDate(today).getDate(); const dim = U.daysInMonth(ym);
    const list = Calc.inMonth(ym); const spent = Calc.totals(list).expense;
    const rec = Calc.recurring(); const recKeys = new Set(rec.map((r) => r.merchant));
    const fixedSpent = U.sum(list.filter((t) => recKeys.has(t.merchant)), (t) => Calc.expenseOf(t));
    const charged = new Set(list.map((t) => t.merchant));
    const fixedPending = U.sum(rec.filter((r) => !charged.has(r.merchant)), (r) => r.monthly);
    const inst = U.sum(Calc.installments().filter((x) => U.ym(x.tx.date) < ym), (x) => x.monthly);
    const variable = Math.max(spent - fixedSpent, 0);
    const projected = U.round(fixedSpent + fixedPending + inst + (variable / day) * dim);
    return { spent, projected, day, dim, fixedPending: U.round(fixedPending + inst) };
  },
};
