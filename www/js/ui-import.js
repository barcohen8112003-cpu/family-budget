'use strict';
/* מסך הייבוא: העלאה, מיפוי עמודות, תצוגה מקדימה ואישור */

const Imp = {
  step: 'upload', queue: [], cur: null, done: [],

  sourceId: (type, institution, name) => `src-${U.hash(`${type}|${institution || ''}|${name.trim()}`)}`,

  async addFiles(files) {
    Imp.queue.push(...files); Imp.done = [];
    if (!Imp.cur) await Imp.next();
  },
  async next() {
    Imp.cur = null;
    const file = Imp.queue.shift();
    if (!file) {
      Imp.step = 'upload';
      if (Imp.done.length) { Period.ym = Calc.latestMonth(); }
      App.render(); return;
    }
    try {
      const { grid, info } = await Parsers.readFile(file);
      const det = Parsers.detect(grid, file.name);
      const existing = S.sources.find((s) => s.institution === det.institution && s.type === det.sourceType && det.institution);
      Imp.cur = {
        file, grid, info, det, sourceType: det.sourceType, institution: det.institution,
        sourceName: existing ? existing.name : det.institutionName || file.name.replace(/\.[^.]+$/, ''),
        manualMapping: false,
      };
      if (det.confident) Imp.buildPreview(); else Imp.step = 'mapping';
    } catch (e) {
      UI.error(e instanceof ImportError ? new ImportError(`${file.name}: ${e.message}`) : e);
      return Imp.next();
    }
    App.render();
  },
  buildPreview() {
    const c = Imp.cur;
    const { rows, skipped } = Parsers.normalize(c.grid, c.det, c.sourceType);
    if (!rows.length) throw new ImportError('לא נמצאו שורות עסקה בקובץ. בדקו את מיפוי העמודות.');
    c.rows = rows; c.skipped = skipped;
    Imp.markDuplicates();
    c.checked = new Set(rows.filter((r) => !r.dup).map((r) => r.row));
    Imp.step = 'preview';
  },
  // כפילות: אותו מקור, תאריך, סכום ותיאור. שורות זהות באותו קובץ מובחנות לפי סדר הופעתן.
  markDuplicates() {
    const c = Imp.cur; const sid = Imp.sourceId(c.sourceType, c.institution, c.sourceName);
    const have = new Set(S.tx.map((t) => t.hash)); const seen = {};
    c.rows.forEach((r) => {
      const base = `${sid}|${r.purchaseDate}|${r.amount}|${r.description}|${r.installment ? r.installment.n : ''}`;
      seen[base] = (seen[base] || 0) + 1;
      r.hash = U.hash(`${base}|${seen[base]}`);
      r.dup = have.has(r.hash);
      r.cc = c.sourceType === 'bank' && r.amount < 0 ? Classify.ccCompany(r.description) : null;
      r.categoryId = r.cc ? 'cc' : Classify.category(r.description, r.amount, c.sourceType);
    });
  },
  async confirm() {
    const c = Imp.cur; const sid = Imp.sourceId(c.sourceType, c.institution, c.sourceName);
    if (!S.sources.find((s) => s.id === sid)) {
      S.sources.push({ id: sid, name: c.sourceName.trim(), type: c.sourceType, institution: c.institution });
      await Store.save('sources');
    }
    if (c.manualMapping) { S.mappings[c.det.signature] = { mapping: c.det.mapping, savedAt: U.today() }; await Store.save('mappings'); }
    const importId = U.uid();
    const list = c.rows.filter((r) => c.checked.has(r.row) && !r.dup).map((r) => ({
      id: U.uid(), hash: r.hash, importId, sourceId: sid, date: r.date, purchaseDate: r.purchaseDate, chargeDate: r.chargeDate,
      description: r.description, merchant: r.merchant, amount: r.amount, originalAmount: r.originalAmount,
      installment: r.installment, details: r.details, categoryId: r.categoryId, ccCharge: r.cc, linked: false,
      member: S.settings.members[0] || '', tags: [], manual: false,
    }));
    await Store.putTx(list);
    Imp.done.push({ name: c.file.name, count: list.length });
    UI.toast(list.length ? `יובאו ${list.length} עסקאות מהקובץ ${c.file.name}` : `לא יובאו עסקאות חדשות מהקובץ ${c.file.name}`);
    await Imp.next();
  },
  cancel() { Imp.queue = []; Imp.cur = null; Imp.step = 'upload'; App.render(); },

  // ---------- מסכים ----------
  renderUpload(main) {
    const srcRows = S.sources.map((s) => {
      const list = S.tx.filter((t) => t.sourceId === s.id); if (!list.length) return '';
      const dates = list.map((t) => t.date).sort();
      return `<div class="item"><div class="grow"><div class="label">${U.esc(s.name)}</div>
        <div class="caption">${s.type === 'credit' ? 'כרטיס אשראי' : 'חשבון בנק'} · ${list.length} עסקאות · <span class="num">${U.il(dates[0])} – ${U.il(dates[dates.length - 1])}</span></div></div>
        <button class="btn sm ghost" data-del-source="${s.id}" aria-label="מחיקת המקור ${U.esc(s.name)}">${UI.icon('trash-2')}</button></div>`;
    }).join('');
    main.innerHTML = `
      <div class="page-head"><h1>ייבוא נתונים</h1>
        <button class="btn" data-manual>${UI.icon('plus')}הוספה ידנית</button></div>
      ${Imp.done.length ? `<div class="alert info" style="margin-bottom:24px">${UI.icon('check')}<div>הייבוא הסתיים: ${Imp.done.map((d) => `${U.esc(d.name)} (${d.count})`).join(', ')}.
        <a href="#" data-go="dashboard">מעבר ללוח הבקרה</a></div></div>` : ''}
      <div class="card">
        <label class="drop" id="drop">
          ${UI.icon('upload')}
          <h3 style="margin-top:12px">גררו לכאן תדפיס בנק או אשראי, או לחצו לבחירת קובץ</h3>
          <p class="muted" style="margin-top:4px">Excel (xlsx, xls), CSV או PDF. אפשר לבחור כמה קבצים יחד.</p>
          <input type="file" id="file" multiple accept=".csv,.txt,.xls,.xlsx,.pdf" hidden>
        </label>
        <div class="row" style="margin-top:16px">
          <button class="btn" data-samples>${UI.icon('file-spreadsheet')}טעינת קובצי דוגמה</button>
          <span class="caption">שלושה תדפיסים פיקטיביים: בנק, ישראכרט ומקס. הקבצים עצמם נמצאים בתיקייה samples.</span>
        </div>
        <p class="caption" style="margin-top:16px">${UI.icon('shield')} הקבצים מעובדים בדפדפן בלבד. שום נתון לא נשלח לשרת.</p>
      </div>
      ${srcRows ? `<div class="card section"><h3>מקורות שיובאו</h3><div class="list">${srcRows}</div></div>` : ''}`;
    const drop = $('#drop', main), input = $('#file', main);
    input.onchange = () => { const f = [...input.files]; input.value = ''; Imp.addFiles(f); };
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => Imp.addFiles([...e.dataTransfer.files]));
    $('[data-samples]', main).onclick = () => Imp.addFiles(Imp.sampleFiles());
    $('[data-manual]', main).onclick = () => TxEdit.open(null);
    const go = $('[data-go]', main); if (go) go.onclick = (e) => { e.preventDefault(); App.go('dashboard'); };
    $$('[data-del-source]', main).forEach((b) => (b.onclick = async () => {
      const s = Calc.source(b.dataset.delSource); const ids = S.tx.filter((t) => t.sourceId === s.id).map((t) => t.id);
      if (!(await UI.confirm(`למחוק את המקור "${s.name}" ואת ${ids.length} העסקאות שלו?`, 'מחיקה', true))) return;
      await Store.delTx(ids); S.sources = S.sources.filter((x) => x.id !== s.id); await Store.save('sources'); App.render();
    }));
  },
  sampleFiles() {
    return (window.SAMPLE_FILES || []).map((f) => {
      const bin = atob(f.b64); const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new File([u8], f.name, { type: f.type });
    });
  },

  renderMapping(main) {
    const c = Imp.cur, d = c.det; const cols = Math.max(...c.grid.slice(d.headerRow, d.headerRow + 8).map((r) => r.length));
    const fieldOf = (i) => Object.keys(d.mapping).find((k) => d.mapping[k] === i) || '';
    const sample = c.grid.slice(d.headerRow + 1, d.headerRow + 7);
    const colIdx = Array.from({ length: cols }, (_, i) => i);
    main.innerHTML = `
      <div class="page-head"><div><h1>מיפוי עמודות</h1><p class="muted">${U.esc(c.file.name)} · ${c.info}</p></div></div>
      <div class="alert warn" style="margin-bottom:24px">${UI.icon('triangle-alert')}<div>לא הצלחנו לזהות בביטחון את כל העמודות. בחרו מעל כל עמודה מה היא מכילה.
        חובה לבחור תאריך, תיאור, וסכום (או חובה/זכות). המיפוי יישמר לקבצים הבאים מאותו מקור.</div></div>
      <div class="card stack">
        <label class="field" style="max-width:220px"><span>שורת הכותרת בקובץ</span>
          <input type="number" id="hdr-row" min="1" max="${c.grid.length}" value="${d.headerRow + 1}"></label>
        <div class="table-wrap"><table>
          <thead><tr>${colIdx.map((i) => `<th><select data-col="${i}" aria-label="תוכן עמודה ${i + 1}"><option value="">התעלם</option>
            ${Object.entries(FIELD_LABELS).map(([k, l]) => `<option value="${k}" ${fieldOf(i) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></th>`).join('')}</tr>
            <tr>${colIdx.map((i) => `<th>${U.esc(d.headers[i] ?? '')}</th>`).join('')}</tr></thead>
          <tbody>${sample.map((r) => `<tr>${colIdx.map((i) => `<td>${U.esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
        <div class="row"><button class="btn primary" data-ok>המשך לתצוגה מקדימה</button><button class="btn ghost" data-cancel>ביטול</button></div>
      </div>`;
    $('#hdr-row', main).onchange = (e) => {
      const n = Math.min(Math.max(+e.target.value || 1, 1), c.grid.length) - 1;
      d.headerRow = n; d.headers = c.grid[n].map(String); d.mapping = Parsers.matchHeaders(c.grid[n]); App.render();
    };
    $$('[data-col]', main).forEach((sel) => (sel.onchange = () => {
      const i = +sel.dataset.col;
      Object.keys(d.mapping).forEach((k) => { if (d.mapping[k] === i) delete d.mapping[k]; });
      if (sel.value) d.mapping[sel.value] = i;
      App.render();
    }));
    $('[data-cancel]', main).onclick = Imp.cancel;
    $('[data-ok]', main).onclick = () => {
      try { c.manualMapping = true; Imp.buildPreview(); App.render(); } catch (e) { UI.error(e); }
    };
  },

  renderPreview(main) {
    const c = Imp.cur; const rows = c.rows;
    const dups = rows.filter((r) => r.dup).length, ccs = rows.filter((r) => r.cc).length, inst = rows.filter((r) => r.installment).length;
    const selected = rows.filter((r) => c.checked.has(r.row) && !r.dup);
    const instNames = [...CC_COMPANIES, ...BANKS];
    main.innerHTML = `
      <div class="page-head"><div><h1>תצוגה מקדימה</h1><p class="muted">${U.esc(c.file.name)} · ${c.info}${Imp.queue.length ? ` · עוד ${Imp.queue.length} קבצים בתור` : ''}</p></div></div>
      <div class="card stack">
        <div class="form-grid">
          <label class="field"><span>שם המקור</span><input id="src-name" value="${U.esc(c.sourceName)}"></label>
          <label class="field"><span>סוג</span><select id="src-type"><option value="bank" ${c.sourceType === 'bank' ? 'selected' : ''}>חשבון בנק</option><option value="credit" ${c.sourceType === 'credit' ? 'selected' : ''}>כרטיס אשראי</option></select></label>
          <label class="field"><span>בנק / חברת אשראי</span><select id="src-inst"><option value="">אחר</option>${instNames.map((x) => `<option value="${x.id}" ${c.institution === x.id ? 'selected' : ''}>${x.name}</option>`).join('')}</select></label>
        </div>
        <div class="row">
          <span class="chip brand">${rows.length} שורות עסקה</span>
          ${dups ? `<span class="chip warn">${UI.icon('copy')}${dups} כפילויות, לא ייובאו</span>` : ''}
          ${ccs ? `<span class="chip">${UI.icon('credit-card')}${ccs} חיובי כרטיס אשראי</span>` : ''}
          ${inst ? `<span class="chip">${UI.icon('calendar-clock')}${inst} בתשלומים</span>` : ''}
          ${c.skipped ? `<span class="chip">${c.skipped} שורות דולגו (ללא תאריך או סכום)</span>` : ''}
          ${c.det.usedSaved ? `<span class="chip ok">${UI.icon('check')}נעשה שימוש במיפוי שמור</span>` : ''}
          <button class="btn sm ghost" data-remap>${UI.icon('columns-3')}עריכת מיפוי העמודות</button>
        </div>
        ${ccs ? `<div class="alert info">${UI.icon('link')}<div>שורות חיוב של כרטיס אשראי יקושרו לפירוט העסקאות מתדפיס האשראי, כך שההוצאה תיספר פעם אחת. חיוב שאין לו פירוט ייספר כהוצאה עד שתייבאו את תדפיס הכרטיס.</div></div>` : ''}
        <div class="table-wrap" style="max-height:520px;overflow:auto"><table>
          <thead><tr><th><input type="checkbox" id="all" aria-label="סימון כל השורות" ${selected.length === rows.length - dups && selected.length ? 'checked' : ''}></th>
            <th>תאריך</th><th>תיאור</th><th class="hide-m">קטגוריה</th><th class="amount">סכום</th></tr></thead>
          <tbody>${rows.map((r) => `<tr class="${r.dup || !c.checked.has(r.row) ? 'off' : ''}">
            <td><input type="checkbox" data-row="${r.row}" ${c.checked.has(r.row) && !r.dup ? 'checked' : ''} ${r.dup ? 'disabled' : ''} aria-label="ייבוא השורה ${U.esc(r.description)}"></td>
            <td><span class="num">${U.il(r.date)}</span></td>
            <td>${U.esc(r.description)}
              ${r.dup ? '<span class="chip warn">כפילות</span>' : ''}
              ${r.cc ? `<span class="chip">חיוב ${CC_COMPANIES.find((x) => x.id === r.cc).name}</span>` : ''}
              ${r.installment ? `<span class="chip">תשלום ${r.installment.n} מתוך ${r.installment.total} · נותרו <span class="num">${U.money((r.installment.total - r.installment.n) * -r.amount)}</span></span>` : ''}</td>
            <td class="hide-m">${UI.cat(r.categoryId)}</td>
            <td class="amount">${UI.money(r.amount, true, r.amount > 0 ? 'income' : 'expense')}</td></tr>`).join('')}</tbody>
        </table></div>
        <div class="row"><button class="btn primary" data-ok ${selected.length ? '' : 'disabled'}>ייבוא ${selected.length} עסקאות</button>
          ${!selected.length ? '<button class="btn" data-skip>דילוג על הקובץ</button>' : ''}
          <button class="btn ghost" data-cancel>ביטול</button>
          <span class="muted label">סה"כ נבחר: ${UI.money(U.sum(selected, (r) => r.amount), true)}</span></div>
      </div>`;
    const reSource = () => { c.sourceName = $('#src-name', main).value || c.sourceName; c.sourceType = $('#src-type', main).value; c.institution = $('#src-inst', main).value || null; };
    $('#src-name', main).onchange = () => { reSource(); Imp.markDuplicates(); c.checked = new Set(c.rows.filter((r) => !r.dup).map((r) => r.row)); App.render(); };
    $('#src-inst', main).onchange = $('#src-name', main).onchange;
    $('#src-type', main).onchange = () => { reSource(); try { Imp.buildPreview(); } catch (e) { UI.error(e); } App.render(); };
    $('#all', main).onchange = (e) => { c.checked = new Set(e.target.checked ? rows.filter((r) => !r.dup).map((r) => r.row) : []); App.render(); };
    $$('[data-row]', main).forEach((cb) => (cb.onchange = () => {
      const n = +cb.dataset.row; if (cb.checked) c.checked.add(n); else c.checked.delete(n);
      const keep = $('.table-wrap', main).scrollTop; App.render(); $('.table-wrap', $('#main')).scrollTop = keep;
    }));
    $('[data-remap]', main).onclick = () => { Imp.step = 'mapping'; App.render(); };
    $('[data-cancel]', main).onclick = Imp.cancel;
    const skip = $('[data-skip]', main); if (skip) skip.onclick = () => Imp.next();
    $('[data-ok]', main).onclick = () => Imp.confirm().catch(UI.error);
  },
};

Views.import = (main) => {
  if (Imp.step === 'mapping' && Imp.cur) Imp.renderMapping(main);
  else if (Imp.step === 'preview' && Imp.cur) Imp.renderPreview(main);
  else Imp.renderUpload(main);
};
