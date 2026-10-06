'use strict';
/* הגדרות: תצוגה, בני משפחה, קטגוריות, כללי סיווג, PIN, גיבוי ומחיקה */

const Settings = {
  ICONS: ['shopping-cart', 'house', 'receipt', 'wifi', 'car', 'bus', 'heart-pulse', 'shield', 'graduation-cap', 'baby', 'shirt', 'utensils', 'repeat', 'package', 'plane', 'gift',
    'arrow-left-right', 'wallet', 'circle-ellipsis', 'credit-card', 'dog', 'dumbbell', 'book', 'coffee', 'fuel', 'hammer', 'music', 'smartphone', 'piggy-bank', 'sparkles', 'briefcase', 'tv'],
  catDialog(cat, parentId = null) {
    const c = cat || { id: `c-${U.uid()}`, name: '', color: '#0f5c57', icon: 'circle-ellipsis', type: 'expense', parentId };
    const isSub = !!c.parentId;
    UI.modal({
      title: cat ? 'עריכת קטגוריה' : isSub ? `תת-קטגוריה חדשה ב"${Cat.get(c.parentId).name}"` : 'קטגוריה חדשה',
      body: `<div class="stack"><label class="field"><span>שם</span><input id="c-name" value="${U.esc(c.name)}"></label>
        ${isSub ? '' : `<div class="form-grid"><label class="field"><span>צבע</span><input type="color" id="c-color" value="${c.color || '#0f5c57'}"></label>
          <label class="field"><span>סוג</span><select id="c-type" ${c.type === 'system' ? 'disabled' : ''}><option value="expense" ${c.type === 'expense' ? 'selected' : ''}>הוצאה</option><option value="income" ${c.type === 'income' ? 'selected' : ''}>הכנסה</option></select></label></div>
        <div><div class="label" style="margin-bottom:8px">אייקון</div><div class="row" id="c-icons">${Settings.ICONS.map((i) => `<button type="button" class="btn sm icon ${c.icon === i ? 'primary' : ''}" data-icon="${i}" aria-label="${i}" aria-pressed="${c.icon === i}">${UI.icon(i)}</button>`).join('')}</div></div>`}</div>`,
      actions: [
        { label: 'שמירה', cls: 'primary', onClick: async (close, el) => {
          const name = $('#c-name', el).value.trim(); if (!name) return UI.toast('חסר שם לקטגוריה.', 'error');
          c.name = name;
          if (!isSub) {
            c.color = $('#c-color', el).value; if (c.type !== 'system') c.type = $('#c-type', el).value;
            const sel = $('[data-icon][aria-pressed="true"]', el); if (sel) c.icon = sel.dataset.icon;
            Cat.children(c.id).forEach((s) => { s.type = c.type; });
          } else c.type = Cat.get(c.parentId).type;
          if (!cat) S.categories.push(c);
          await Store.save('categories'); close(); App.render();
        } },
        { label: 'ביטול', cls: 'ghost', onClick: (close) => close() },
        ...(cat && !['other', 'cc', 'income'].includes(cat.id) ? [{ label: 'מחיקה', cls: 'danger', onClick: async (close) => {
          const ids = Cat.family(cat.id); const target = cat.parentId || 'other';
          const used = S.tx.filter((t) => ids.includes(t.categoryId) || (t.splits || []).some((s) => ids.includes(s.categoryId)));
          if (!(await UI.confirm(`למחוק את "${cat.name}"?${used.length ? ` ${used.length} עסקאות יעברו ל"${Cat.get(target).name}".` : ''}`, 'מחיקה', true))) return;
          used.forEach((t) => { if (ids.includes(t.categoryId)) t.categoryId = target; (t.splits || []).forEach((s) => { if (ids.includes(s.categoryId)) s.categoryId = target; }); });
          if (used.length) await Store.putTx(used);
          S.categories = S.categories.filter((x) => !ids.includes(x.id));
          ids.forEach((id) => delete S.budgets[id]);
          Object.keys(S.rules).forEach((k) => { if (ids.includes(S.rules[k])) delete S.rules[k]; });
          await Store.save('categories'); await Store.save('budgets'); await Store.save('rules'); close(); App.render();
        } }] : []),
      ],
    });
    $$('#c-icons [data-icon]').forEach((b) => (b.onclick = () => {
      $$('#c-icons [data-icon]').forEach((x) => { x.classList.remove('primary'); x.setAttribute('aria-pressed', 'false'); });
      b.classList.add('primary'); b.setAttribute('aria-pressed', 'true');
    }));
  },
  pinDialog() {
    UI.modal({
      title: 'הגדרת קוד PIN',
      body: `<div class="stack"><p class="muted">הקוד יידרש בכל פתיחה של האפליקציה. אם תשכחו אותו, לא ניתן לשחזר אותו.</p>
        <label class="field"><span>קוד חדש (4 עד 8 ספרות)</span><input type="password" inputmode="numeric" id="p1" maxlength="8" autocomplete="off"></label>
        <label class="field"><span>הקלידו שוב</span><input type="password" inputmode="numeric" id="p2" maxlength="8" autocomplete="off"></label></div>`,
      actions: [{ label: 'שמירה', cls: 'primary', onClick: async (close, el) => {
        const a = $('#p1', el).value, b = $('#p2', el).value;
        if (!/^\d{4,8}$/.test(a)) return UI.toast('הקוד צריך להכיל 4 עד 8 ספרות.', 'error');
        if (a !== b) return UI.toast('שני הקודים אינם זהים.', 'error');
        S.settings.pinHash = await App.pinHash(a); await Store.save('settings'); close(); UI.toast('קוד ה-PIN הוגדר'); App.render();
      } }, { label: 'ביטול', cls: 'ghost', onClick: (close) => close() }],
    });
  },
};

Views.settings = (main) => {
  const rules = Object.entries(S.rules);
  main.innerHTML = `
    <div class="page-head"><h1>הגדרות</h1></div>
    <div class="grid c2">
      <div class="card stack"><h3>תצוגה</h3>
        <div class="seg" role="group" aria-label="ערכת צבעים">${[['auto', 'לפי המכשיר'], ['light', 'בהיר'], ['dark', 'כהה']].map(([k, l]) => `<button data-theme="${k}" aria-pressed="${S.settings.theme === k}">${l}</button>`).join('')}</div>
        <h3 style="margin-top:8px">בני משפחה</h3>
        <div class="row">${S.settings.members.map((m, i) => `<span class="chip" style="padding:6px 8px">${U.esc(m)}${i ? ` <button class="btn sm ghost icon" style="min-height:24px;width:24px" data-del-member="${i}" aria-label="הסרת ${U.esc(m)}">${UI.icon('x')}</button>` : ''}</span>`).join('')}</div>
        <form class="row" id="member-form"><input id="member" placeholder="שם, למשל: אבא" aria-label="שם בן משפחה חדש" style="flex:1;min-width:140px"><button class="btn">הוספה</button></form>
      </div>
      <div class="card stack"><h3>פרטיות וגיבוי</h3>
        <p class="caption">${UI.icon('shield')} כל הנתונים נשמרים במכשיר הזה בלבד (IndexedDB). הקבצים מעובדים באפליקציה ולא נשלחים לשום שרת.</p>
        <div class="row"><button class="btn" data-pin>${UI.icon('lock')}${S.settings.pinHash ? 'החלפת קוד PIN' : 'הגדרת קוד PIN'}</button>
          ${S.settings.pinHash ? '<button class="btn ghost" data-pin-off>ביטול הקוד</button>' : ''}</div>
        <div class="row"><button class="btn" data-backup>${UI.icon('download')}גיבוי לקובץ JSON</button>
          <label class="btn">${UI.icon('upload')}שחזור מגיבוי<input type="file" accept=".json,application/json" id="restore" hidden></label></div>
        <div class="row"><button class="btn danger" data-wipe>${UI.icon('trash-2')}מחק את כל הנתונים</button></div>
        <p class="caption">${S.tx.length} עסקאות · ${S.sources.length} מקורות · ${Object.keys(S.mappings).length} מיפויי עמודות שמורים</p>
      </div>
    </div>
    ${Notif.card()}
    <div class="card section"><div class="row between" style="margin-bottom:16px"><h3>קטגוריות</h3><button class="btn sm" data-cat-add>${UI.icon('plus')}קטגוריה חדשה</button></div>
      <div class="list">${Cat.tops().map((c) => `<div class="item" style="flex-wrap:wrap"><div class="grow">${UI.cat(c.id)}
          <div class="row" style="margin-top:6px;gap:6px">${Cat.children(c.id).map((s) => `<button class="chip" style="border:0;cursor:pointer" data-cat-edit="${s.id}">${U.esc(s.name)}</button>`).join('')}
            ${c.type !== 'system' ? `<button class="chip brand" style="border:0;cursor:pointer" data-sub-add="${c.id}">+ תת-קטגוריה</button>` : ''}</div></div>
          <span class="caption">${c.type === 'income' ? 'הכנסה' : c.type === 'system' ? 'מערכת' : 'הוצאה'}</span>
          <button class="btn sm ghost icon" data-cat-edit="${c.id}" aria-label="עריכת ${U.esc(c.name)}">${UI.icon('pencil')}</button></div>`).join('')}</div></div>
    <div class="card section"><h3>כללי סיווג שנלמדו</h3>
      ${rules.length ? `<div class="list">${rules.map(([k, v]) => `<div class="item"><div class="grow ellipsis">${U.esc(k)}</div>${UI.cat(v)}<button class="btn sm ghost icon" data-del-rule="${U.esc(k)}" aria-label="מחיקת הכלל">${UI.icon('trash-2')}</button></div>`).join('')}</div>`
    : '<p class="muted">כשתשנו קטגוריה של עסקה ותבחרו להחיל על כל העסקאות מאותו בית עסק, הכלל יופיע כאן.</p>'}</div>`;

  Notif.bind(main);
  $$('[data-theme]', main).forEach((b) => (b.onclick = async () => { S.settings.theme = b.dataset.theme; await Store.save('settings'); App.applyTheme(); App.render(); }));
  $('#member-form', main).onsubmit = async (e) => {
    e.preventDefault(); const v = $('#member', main).value.trim();
    if (v && !S.settings.members.includes(v)) { S.settings.members.push(v); await Store.save('settings'); App.render(); }
  };
  $$('[data-del-member]', main).forEach((b) => (b.onclick = async () => { S.settings.members.splice(+b.dataset.delMember, 1); await Store.save('settings'); App.render(); }));
  $('[data-pin]', main).onclick = Settings.pinDialog;
  const off = $('[data-pin-off]', main); if (off) off.onclick = async () => { S.settings.pinHash = null; await Store.save('settings'); UI.toast('קוד ה-PIN בוטל'); App.render(); };
  $('[data-backup]', main).onclick = () => Export.backup().catch(UI.error);
  $('#restore', main).onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (!(await UI.confirm('השחזור יחליף את כל הנתונים הקיימים בנתוני הגיבוי. להמשיך?', 'שחזור', true))) return;
    try { await Export.restore(file); App.applyTheme(); UI.toast('הנתונים שוחזרו'); Period.ym = Calc.latestMonth(); App.go('dashboard'); } catch (err) { UI.error(err); }
  };
  $('[data-wipe]', main).onclick = async () => {
    if (!(await UI.confirm('למחוק את כל העסקאות, התקציבים, היעדים וההגדרות מהמכשיר?', 'המשך', true))) return;
    if (!(await UI.confirm('אישור אחרון: המחיקה סופית ואי אפשר לבטל אותה. מומלץ לגבות לפני כן. למחוק הכול?', 'מחק הכול', true))) return;
    await Store.wipe(); Tx.f = null; UI.toast('כל הנתונים נמחקו'); App.go('import');
  };
  $('[data-cat-add]', main).onclick = () => Settings.catDialog(null);
  $$('[data-cat-edit]', main).forEach((b) => (b.onclick = () => Settings.catDialog(S.categories.find((c) => c.id === b.dataset.catEdit))));
  $$('[data-sub-add]', main).forEach((b) => (b.onclick = () => Settings.catDialog(null, b.dataset.subAdd)));
  $$('[data-del-rule]', main).forEach((b) => (b.onclick = async () => { delete S.rules[b.dataset.delRule]; await Store.save('rules'); App.render(); }));
};
