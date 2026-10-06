'use strict';
/* מעקב בזמן אמת: פענוח התראות (אפליקציה או SMS) של חברות האשראי והבנקים לעסקאות */

const Notif = {
  TX_WORDS: /עסקה|עסקת|חיוב|חויב|רכישה|רכשת|קנייה|קניה|שולם|תשלום|משיכה|נמשך|העברה|הועבר|זיכוי|זוכה|הופקד|הפקדה|התקבל|בוצע/,
  PROMO: /הלוואה|הטבה|מבצע|הצעה|מסגרת אשראי|הגדלת מסגרת|קוד אימות|סיסמה/,
  INCOME: /זיכוי|זוכה|זוכית|הופקד|הפקדה|התקבל|התקבלה|נכנס|משכורת|החזר/,
  PKG_HINTS: [[/cal4u|onoapps\.cal/i, 'cal'], [/leumicard|max\.|\.max/i, 'max'], [/isracard/i, 'isracard'], [/amex|americanexpress/i, 'amex'],
    [/leumi/i, 'leumi'], [/poalim/i, 'poalim'], [/discount/i, 'discount'], [/mizrahi/i, 'mizrahi'], [/fibi/i, 'fibi']],

  // במהדורה הרגילה (lite) של ה-APK אין קריאת התראות
  available: () => Platform.android() && typeof window.AndroidBridge.pullNotifications === 'function'
    && (typeof window.AndroidBridge.hasNotif !== 'function' || window.AndroidBridge.hasNotif()),
  enabled: () => Notif.available() && window.AndroidBridge.notifEnabled(),

  amount(text) {
    const m = text.match(/(?:₪|ש"ח|ש״ח|NIS|ILS)\s*(-?[\d,]+(?:\.\d+)?)/i) || text.match(/(-?[\d,]+(?:\.\d+)?)\s*(?:₪|ש"ח|ש״ח|שח(?![א-ת])|NIS|ILS)/i);
    if (!m) return NaN;
    return Math.abs(parseFloat(m[1].replace(/,/g, '')));
  },
  merchant(text) {
    const clean = (s) => s.replace(/\s+(בתאריך|בכרטיס|בסך|על סך|בסכום|לפרטים|למידע|להסרה|בוצע|בוצעה|בחשבונך|מחשבונך|לחשבונך).*$/, '').replace(/[\s"'״׳.\-]+$/, '').trim();
    // שם בית העסק נגמר בפסיק, בסוף שורה או בנקודה שאחריה רווח (נקודה באמצע, כמו NETFLIX.COM, נשארת)
    const END = '(?=,|\\n|\\.\\s|\\.$|$)';
    const tries = [
      new RegExp(`(?:בבית העסק|בבית עסק|בית העסק|אצל)\\s*:?\\s*(.{2,40}?)${END}`),
      new RegExp(`(?:בסך|על סך|בסכום)[^א-תA-Za-z\\n]*ב-?\\s*([^\\d\\s.,].{1,40}?)${END}`),
      /(?:^|\s)ב-?\s*([^\d\s.,][^,\n]{1,40}?)\s+(?:בסך|על סך|בסכום)/,
      new RegExp(`(?:עבור|ל-?טובת|אל)\\s*:?\\s*([^\\d,\\n]{2,40}?)${END}`),
      /\s[-–]\s*([^\d.,\n]{2,30})$/,
    ];
    for (const re of tries) {
      const m = text.match(re);
      if (m) { const v = clean(m[1]); if (v.length >= 2 && !/^(כרטיס|סך|תאריך)/.test(v)) return v; }
    }
    return null;
  },
  institution(n) {
    const hint = Notif.PKG_HINTS.find(([re]) => re.test(n.pkg || ''));
    if (hint) return hint[1];
    const hay = `${n.title || ''} ${n.text || ''}`;
    const c = CC_COMPANIES.find((x) => x.re.test(hay)) || BANKS.find((x) => x.re.test(hay));
    return c ? c.id : null;
  },
  // מחזיר עסקה מפוענחת, או {ignored: סיבה}
  parse(n) {
    const text = `${n.text || ''}`.replace(/[‎‏‪-‮]/g, '').replace(/\s+/g, ' ').trim();
    const amount = Notif.amount(text);
    if (isNaN(amount) || amount === 0) return { ignored: 'לא נמצא סכום בשקלים' };
    const inst = Notif.institution(n);
    if (!inst) return { ignored: 'לא זוהה בנק או חברת אשראי' };
    if (!Notif.TX_WORDS.test(text)) return { ignored: 'לא נראה כמו עסקה' };
    if (Notif.PROMO.test(text) && !/עסקה|חיוב|רכישה/.test(text)) return { ignored: 'נראה כמו הודעה שיווקית' };
    const isCard = CC_COMPANIES.some((c) => c.id === inst);
    const info = [...CC_COMPANIES, ...BANKS].find((x) => x.id === inst);
    const income = Notif.INCOME.test(text) && !/חיוב|חויב|רכישה|נמשך|משיכה/.test(text);
    const merchant = Notif.merchant(text);
    const card = (text.match(/(?:המסתיים ב|מסתיים ב|שמספרו|כרטיס)\D{0,6}(\d{4})(?!\d)/) || [])[1];
    return {
      institution: inst, sourceType: isCard ? 'credit' : 'bank', sourceName: info.name,
      amount: U.round(income ? amount : -amount), description: merchant || `${info.name}: ${income ? 'הפקדה' : isCard ? 'עסקה בכרטיס' : 'חיוב בחשבון'}`,
      hasMerchant: !!merchant, date: U.iso(new Date(n.time || Date.now())), card: card || null, raw: text,
    };
  },

  async ingest(list) {
    const added = [];
    for (const n of list) {
      const key = U.hash(`notif|${n.pkg}|${n.text}|${Math.round((n.time || 0) / 6e5)}`);
      if (S.notifLog.some((l) => l.key === key)) continue;
      const p = Notif.parse(n);
      const log = { key, time: n.time || Date.now(), pkg: n.pkg || '', title: n.title || '', text: n.text || '', status: 'ignored', reason: p.ignored || '' };
      if (!p.ignored) {
        const sid = Imp.sourceId(p.sourceType, p.institution, p.sourceName);
        if (!S.sources.find((s) => s.id === sid)) { S.sources.push({ id: sid, name: p.sourceName, type: p.sourceType, institution: p.institution }); await Store.save('sources'); }
        const cc = p.sourceType === 'bank' && p.amount < 0 ? Classify.ccCompany(p.raw) : null;
        const t = {
          id: U.uid(), hash: key, sourceId: sid, date: p.date, purchaseDate: p.date, chargeDate: null, description: p.description, merchant: Classify.merchantKey(p.description),
          amount: p.amount, categoryId: cc ? 'cc' : Classify.category(p.description, p.amount, p.sourceType), ccCharge: cc, linked: false,
          member: S.settings.members[0] || '', tags: [], manual: false, fromNotif: true, details: p.raw + (p.card ? ` (כרטיס ${p.card})` : ''),
        };
        added.push(t); log.status = 'added'; log.txId = t.id;
      }
      S.notifLog.unshift(log);
    }
    S.notifLog = S.notifLog.slice(0, 100);
    await Store.save('notifLog');
    if (added.length) {
      await Store.putTx(added);
      UI.toast(added.length === 1 ? `נקלטה עסקה מהתראה: ${added[0].description}, ${U.money(-added[0].amount)}` : `נקלטו ${added.length} עסקאות מהתראות`);
    }
    return added;
  },
  pulling: false,
  async pull() {
    if (!Notif.available() || Notif.pulling || !DB.db) return;
    Notif.pulling = true;
    try {
      const raw = JSON.parse(window.AndroidBridge.pullNotifications() || '[]');
      if (raw.length) { const added = await Notif.ingest(raw); if (added.length || App.route === 'settings') App.render(); }
    } catch (e) { console.error(e); } finally { Notif.pulling = false; }
  },
  // בייבוא תדפיס: עסקה שכבר נקלטה מהתראה מוחלפת בשורת התדפיס. מחזיר מזהים למחיקה.
  supersededBy(rows, sourceId) {
    const pool = S.tx.filter((t) => t.fromNotif && t.sourceId === sourceId); const used = new Set();
    rows.forEach((r) => {
      const hit = pool.find((t) => !used.has(t.id) && Math.abs(t.amount - r.amount) < 0.01 && Math.abs(U.daysBetween(t.date, r.purchaseDate || r.date)) <= 4);
      if (hit) used.add(hit.id);
    });
    return [...used];
  },

  // ---------- כרטיס בהגדרות ----------
  card() {
    const on = Notif.enabled();
    const log = S.notifLog.slice(0, 15);
    return `<div class="card section stack"><div class="row between"><h3>מעקב בזמן אמת מהתראות</h3>
        ${Notif.available() ? `<span class="chip ${on ? 'ok' : 'warn'}">${UI.icon(on ? 'circle-check' : 'triangle-alert')}${on ? 'פעיל' : 'כבוי'}</span>` : `<span class="chip">${Platform.android() ? 'זמין במהדורה המלאה' : 'זמין באפליקציית האנדרואיד'}</span>`}</div>
      <p class="muted label">האפליקציה קוראת התראות ו-SMS על עסקאות מחברת האשראי ומהבנק, ומוסיפה אותן מיד כעסקאות. כשתייבאו את התדפיס, שורות התדפיס יחליפו אותן ולא ייווצרו כפילויות. ההתראות נשמרות במכשיר בלבד.</p>
      ${Notif.available() ? `<div class="row"><button class="btn ${on ? '' : 'primary'}" data-notif-open>${UI.icon('bell')}${on ? 'הגדרות גישה להתראות' : 'הפעלת גישה להתראות'}</button>
        <button class="btn ghost" data-notif-app>פרטי האפליקציה</button></div>
      ${on ? '' : `<p class="caption">אם האפשרות אפורה: פתחו "פרטי האפליקציה", לחצו על שלוש הנקודות למעלה ובחרו "אפשר הגדרות מוגבלות", ואז חזרו לכאן. ודאו גם שבאפליקציית כאל ובאפליקציית הבנק מופעלות התראות על כל עסקה.</p>`}` : ''}
      <details><summary class="label" style="cursor:pointer">בדיקת נוסח של התראה</summary>
        <div class="stack" style="margin-top:12px"><textarea id="notif-test" rows="3" style="padding:8px;min-height:80px" placeholder='הדביקו כאן טקסט של התראה, למשל: בוצעה עסקה בכרטיסך המסתיים ב-1234 בסך 54.90 ש"ח בבית העסק NETFLIX' aria-label="טקסט התראה לבדיקה"></textarea>
        <div class="row"><select id="notif-test-inst" aria-label="מקור ההתראה">${[...CC_COMPANIES, ...BANKS].map((x) => `<option value="${x.id}">${x.name}</option>`).join('')}</select><button class="btn sm" data-notif-test>בדיקה</button></div>
        <div id="notif-test-out" class="caption"></div></div></details>
      ${log.length ? `<div><div class="label" style="margin-bottom:4px">התראות אחרונות שנקלטו</div><div class="list">${log.map((l, i) => `<div class="item"><div class="grow"><div class="caption"><span class="num">${U.il(U.iso(new Date(l.time)))}</span> · ${U.esc(l.title || l.pkg)}</div><div style="font-size:14px">${U.esc(l.text)}</div></div>
          ${l.status === 'added' ? `<span class="chip ok">נוספה</span>` : `<span class="chip" title="${U.esc(l.reason)}">דולגה</span><button class="btn sm" data-notif-add="${i}">הוספה ידנית</button>`}</div>`).join('')}</div></div>` : ''}
    </div>`;
  },
  bind(main) {
    const o = $('[data-notif-open]', main); if (o) o.onclick = () => window.AndroidBridge.openNotifSettings();
    const a = $('[data-notif-app]', main); if (a) a.onclick = () => window.AndroidBridge.openAppInfo();
    $('[data-notif-test]', main).onclick = () => {
      const text = $('#notif-test', main).value.trim(); if (!text) return;
      const inst = [...CC_COMPANIES, ...BANKS].find((x) => x.id === $('#notif-test-inst', main).value);
      const p = Notif.parse({ pkg: '', title: inst.name, text, time: Date.now() });
      $('#notif-test-out', main).innerHTML = p.ignored ? `<span class="warn">ההתראה תדולג: ${p.ignored}.</span>`
        : `<span class="ok">תזוהה כעסקה:</span> ${U.esc(p.description)} · <span class="num">${U.money(p.amount, true)}</span> · ${U.esc(p.sourceName)} · ${U.esc(Cat.label(Classify.category(p.description, p.amount, p.sourceType)))}${p.hasMerchant ? '' : ' <span class="warn">(שם בית העסק לא זוהה)</span>'}`;
    };
    $$('[data-notif-add]', main).forEach((b) => (b.onclick = () => {
      const l = S.notifLog[+b.dataset.notifAdd]; const amt = Notif.amount(l.text);
      TxEdit.open(null, { description: Notif.merchant(l.text) || l.title || '', amount: isNaN(amt) ? '' : amt, date: U.iso(new Date(l.time)), notes: l.text.slice(0, 120) });
    }));
  },
};
