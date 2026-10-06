'use strict';
/* ייצוא ל-Excel, דוח להדפסה, גיבוי ושחזור. Platform מגשר בין דפדפן לאפליקציית האנדרואיד */

const Platform = {
  android: () => typeof window.AndroidBridge !== 'undefined',
  async save(blob, name) {
    if (!Platform.android()) return UI.download(blob, name);
    const u8 = new Uint8Array(await blob.arrayBuffer()); let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    window.AndroidBridge.saveFile(name, blob.type || 'application/octet-stream', btoa(bin));
  },
  print(title) { if (Platform.android()) window.AndroidBridge.print(title); else window.print(); },
};

const Export = {
  dialog(list, f) {
    const dates = S.tx.map((t) => t.date).sort();
    UI.modal({
      title: 'ייצוא ל-Excel',
      body: `<div class="stack">
        <label class="row"><input type="radio" name="x-mode" value="filter" checked> לפי הסינון הנוכחי (${list.length} עסקאות)</label>
        <label class="row"><input type="radio" name="x-mode" value="range"> לפי טווח תאריכים</label>
        <div class="form-grid"><label class="field"><span>מתאריך</span><input type="date" id="x-from" value="${f.from || dates[0] || ''}"></label>
          <label class="field"><span>עד תאריך</span><input type="date" id="x-to" value="${f.to || dates[dates.length - 1] || ''}"></label></div>
        <p class="caption">הקובץ כולל ארבעה גיליונות: עסקאות, סיכום חודשי, לפי קטגוריות, ותקציב מול ביצוע. חיובי אשראי שמקושרים לפירוט אינם נכללים, כדי שלא ייספרו פעמיים.</p></div>`,
      actions: [
        { label: 'ייצוא', cls: 'primary', onClick: async (close, el) => {
          try {
            let rows = list;
            if ($('[name="x-mode"]:checked', el).value === 'range') {
              const from = $('#x-from', el).value, to = $('#x-to', el).value;
              if (!from || !to || from > to) return UI.toast('טווח התאריכים אינו תקין.', 'error');
              rows = Calc.inRange(from, to);
            }
            if (!rows.length) return UI.toast('אין עסקאות לייצוא.', 'error');
            await Export.xlsx(rows); close();
          } catch (e) { UI.error(e); }
        } },
        { label: 'ביטול', cls: 'ghost', onClick: (close) => close() },
      ],
    });
  },

  async xlsx(list) {
    if (!window.ExcelJS) throw new Error('רכיב הייצוא ל-Excel לא נטען.');
    const rows = list.filter(Calc.counts).sort((a, b) => (a.date < b.date ? -1 : 1));
    const NIS = '#,##0.00 "₪"';
    const wb = new ExcelJS.Workbook(); wb.creator = 'תקציב משפחתי'; wb.created = new Date();
    const sheet = (name) => wb.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    const style = (ws, moneyCols = [], totalRow = true) => {
      const head = ws.getRow(1); head.font = { bold: true }; head.alignment = { horizontal: 'right', vertical: 'middle' };
      head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD7EBE8' } }; c.border = { bottom: { style: 'thin' } }; });
      moneyCols.forEach((i) => { ws.getColumn(i).numFmt = NIS; });
      if (totalRow) { const last = ws.lastRow; last.font = { bold: true }; last.eachCell((c) => { c.border = { top: { style: 'thin' } }; }); }
      ws.columns.forEach((col) => { // רוחב אוטומטי
        let w = 8;
        col.eachCell({ includeEmpty: false }, (c) => {
          const v = c.value; const s = v instanceof Date ? '00/00/0000' : v && v.formula ? '000,000.00 ₪' : typeof v === 'number' ? `${v.toFixed(2)} ₪₪` : String(v ?? '');
          w = Math.max(w, s.length + 2);
        });
        col.width = Math.min(w, 60);
      });
    };
    const col = (n) => { let s = ''; while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };
    const sum = (c, from, to) => ({ formula: `SUM(${col(c)}${from}:${col(c)}${to})` });
    const xdate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };

    // 1. עסקאות
    let ws = sheet('עסקאות');
    ws.addRow(['תאריך', 'תיאור', 'קטגוריה', 'סכום', 'מקור', 'בן משפחה', 'תגיות']);
    rows.forEach((t) => {
      const label = t.splits && t.splits.length ? t.splits.map((s) => `${Cat.label(s.categoryId)} (${Math.abs(s.amount)})`).join(' + ') : Cat.label(t.categoryId);
      ws.addRow([xdate(t.date), t.description, label, t.amount, (Calc.source(t.sourceId) || {}).name || '', t.member || '', (t.tags || []).join(', ')]);
    });
    ws.getColumn(1).numFmt = 'dd/mm/yyyy';
    ws.addRow(['סה"כ', '', '', sum(4, 2, rows.length + 1)]);
    ws.autoFilter = { from: 'A1', to: `G${rows.length + 1}` };
    style(ws, [4]);

    // 2. סיכום חודשי
    const months = [...new Set(rows.map((t) => U.ym(t.date)))].sort();
    const mt = months.map((m) => Calc.totals(rows.filter((t) => t.date.startsWith(m))));
    ws = sheet('סיכום חודשי');
    ws.addRow(['חודש', 'הכנסות', 'הוצאות', 'מאזן']);
    months.forEach((m, i) => ws.addRow([U.monthName(m), mt[i].income, mt[i].expense, { formula: `B${i + 2}-C${i + 2}` }]));
    ws.addRow(['סה"כ', sum(2, 2, months.length + 1), sum(3, 2, months.length + 1), sum(4, 2, months.length + 1)]);
    style(ws, [2, 3, 4]);

    // 3. לפי קטגוריות (טבלת ציר: קטגוריה × חודש)
    ws = sheet('לפי קטגוריות');
    ws.addRow(['קטגוריה', ...months.map(U.monthName), 'סה"כ']);
    const cats = Cat.tops().filter((c) => c.type !== 'income' && mt.some((x) => x.byCat[c.id]));
    cats.forEach((c, i) => ws.addRow([c.name, ...mt.map((x) => x.byCat[c.id] || 0), { formula: `SUM(B${i + 2}:${col(months.length + 1)}${i + 2})` }]));
    ws.addRow(['סה"כ', ...months.map((_, j) => sum(j + 2, 2, cats.length + 1)), sum(months.length + 2, 2, cats.length + 1)]);
    style(ws, months.map((_, j) => j + 2).concat(months.length + 2));

    // 4. תקציב מול ביצוע
    ws = sheet('תקציב מול ביצוע');
    ws.addRow(['קטגוריה', 'תקציב חודשי', `תקציב לתקופה (${months.length} חודשים)`, 'ביצוע', 'הפרש', 'ניצול']);
    const all = Calc.totals(rows).byCat;
    const bcats = Cat.tops().filter((c) => c.type === 'expense' && (S.budgets[c.id] || all[c.id]));
    bcats.forEach((c, i) => { const r = i + 2; ws.addRow([c.name, S.budgets[c.id] || 0, { formula: `B${r}*${months.length}` }, all[c.id] || 0, { formula: `C${r}-D${r}` }, { formula: `IF(C${r}=0,"",D${r}/C${r})` }]); });
    const n = bcats.length + 1;
    ws.addRow(['סה"כ', sum(2, 2, n), sum(3, 2, n), sum(4, 2, n), sum(5, 2, n), { formula: `IF(C${n + 1}=0,"",D${n + 1}/C${n + 1})` }]);
    style(ws, [2, 3, 4, 5]); ws.getColumn(6).numFmt = '0%';

    const buf = await wb.xlsx.writeBuffer();
    const name = `תקציב-משפחתי-${rows[0].date}_${rows[rows.length - 1].date}.xlsx`;
    await Platform.save(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
    UI.toast(`הקובץ ${name} נשמר`);
  },

  async backup() {
    const blob = new Blob([JSON.stringify(Store.exportAll())], { type: 'application/json' });
    await Platform.save(blob, `גיבוי-תקציב-משפחתי-${U.today()}.json`);
    UI.toast('קובץ הגיבוי נשמר');
  },
  async restore(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { throw new Error('הקובץ אינו קובץ JSON תקין.'); }
    await Store.importAll(data);
  },
  print() { App.go('report'); },
};

// דוח חודשי מסכם להדפסה / שמירה כ-PDF
Views.report = (main) => {
  const r = Period.range(); const list = Calc.inRange(r.from, r.to); const tot = Calc.totals(list);
  const cats = Object.entries(tot.byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const status = Budget.status(r.from.slice(0, 7), Period.step());
  const top = list.filter((t) => Calc.expenseOf(t) > 0).sort((a, b) => Calc.expenseOf(b) - Calc.expenseOf(a)).slice(0, 10);
  const incomes = list.filter((t) => Calc.counts(t) && Cat.isIncome(t.categoryId));
  const rec = Calc.recurring();
  main.innerHTML = `
    <div class="page-head"><div><h1>דוח מסכם: ${r.label}</h1><p class="muted">הופק ב-<span class="num">${U.il(U.today())}</span> · תקציב משפחתי</p></div>
      <div class="row no-print"><button class="btn primary" data-print>${UI.icon('printer')}הדפסה / שמירה כ-PDF</button><button class="btn" data-back>חזרה</button></div></div>
    <div class="grid c3">
      <div class="card stat"><div class="label">הכנסות</div><div class="amount income">${UI.money(tot.income)}</div></div>
      <div class="card stat"><div class="label">הוצאות</div><div class="amount expense">${UI.money(tot.expense)}</div></div>
      <div class="card stat"><div class="label">${tot.balance >= 0 ? 'חיסכון' : 'גירעון'}</div><div class="amount">${UI.money(tot.balance, true)}</div></div>
    </div>
    <div class="section"><h3 style="margin-bottom:8px">הוצאות לפי קטגוריה</h3><div class="table-wrap"><table>
      <thead><tr><th>קטגוריה</th><th class="amount">סכום</th><th class="amount">חלק</th><th class="amount">תקציב</th><th>מצב</th></tr></thead>
      <tbody>${cats.map(([id, v]) => { const s = status.find((x) => x.id === id); return `<tr><td>${U.esc(Cat.get(id).name)}</td><td class="amount">${UI.money(v)}</td><td class="amount"><span class="num">${Math.round((v / tot.expense) * 100)}%</span></td><td class="amount">${s ? UI.money(s.budget) : '–'}</td><td>${s ? `${Budget.word[s.level]} (<span class="num">${s.pct}%</span>)` : ''}</td></tr>`; }).join('')}</tbody>
      <tfoot><tr><td>סה"כ</td><td class="amount">${UI.money(tot.expense)}</td><td></td><td class="amount">${status.length ? UI.money(U.sum(status, (s) => s.budget)) : ''}</td><td></td></tr></tfoot></table></div></div>
    <div class="section"><h3 style="margin-bottom:8px">הכנסות</h3><div class="table-wrap"><table><thead><tr><th>תאריך</th><th>תיאור</th><th class="amount">סכום</th></tr></thead>
      <tbody>${incomes.map((t) => `<tr><td><span class="num">${U.il(t.date)}</span></td><td>${U.esc(t.description)}</td><td class="amount">${UI.money(t.amount)}</td></tr>`).join('') || '<tr><td colspan="3">אין הכנסות בתקופה.</td></tr>'}</tbody></table></div></div>
    <div class="section"><h3 style="margin-bottom:8px">10 ההוצאות הגדולות</h3><div class="table-wrap"><table><thead><tr><th>תאריך</th><th>תיאור</th><th>קטגוריה</th><th class="amount">סכום</th></tr></thead>
      <tbody>${top.map((t) => `<tr><td><span class="num">${U.il(t.date)}</span></td><td>${U.esc(t.description)}</td><td>${U.esc(Cat.label(t.categoryId))}</td><td class="amount">${UI.money(Calc.expenseOf(t))}</td></tr>`).join('')}</tbody></table></div></div>
    ${rec.length ? `<div class="section"><h3 style="margin-bottom:8px">הוצאות קבועות ומנויים</h3><div class="table-wrap"><table><thead><tr><th>שם</th><th class="amount">חודשי</th><th class="amount">שנתי</th></tr></thead>
      <tbody>${rec.map((x) => `<tr><td>${U.esc(x.name)}</td><td class="amount">${UI.money(x.monthly)}</td><td class="amount">${UI.money(x.yearly)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>סה"כ</td><td class="amount">${UI.money(U.sum(rec, (x) => x.monthly))}</td><td class="amount">${UI.money(U.sum(rec, (x) => x.yearly))}</td></tr></tfoot></table></div></div>` : ''}`;
  $('[data-print]', main).onclick = () => Platform.print(`דוח ${r.label}`);
  $('[data-back]', main).onclick = () => App.go('dashboard');
};
