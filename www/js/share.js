'use strict';
/* שיתוף תקציב בקישור: לצפייה או לעריכה, מסונכרן בענן.
   התקציב מוצפן בטלפון ונשמר בשרת כעותק מוצפן אחד. הקישור מכיל אחרי ה-# מזהה ומפתח פענוח,
   ובקישור עריכה גם אסימון כתיבה. מה שאחרי ה-# לא נשלח לשרת בפתיחת הקישור.
   סנכרון: כל טלפון ממזג את העותק מהענן עם השינויים שלו (כל עסקה בנפרד, לפי זמן העדכון,
   ומחיקות נשמרות כ"מצבות" כדי שעסקה שנמחקה לא תחזור), ומעלה רק אם העותק בענן לא השתנה בינתיים. */

const Share = {
  SITE: 'https://family-budget.naorkurtz1.workers.dev',
  syncing: false, timer: null,
  SHARED_KEYS: ['categories', 'budgets', 'goals', 'sources', 'settings'],

  // ---------- עזרי הצפנה ----------
  b64u: (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); },
  rand: (n) => Share.b64u(crypto.getRandomValues(new Uint8Array(n))),
  key: (k) => crypto.subtle.importKey('raw', Share.unb64u(k), 'AES-GCM', false, ['encrypt', 'decrypt']),
  async pipe(u8, stream) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer()); },
  bin(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); },
  async encrypt(obj, k) {
    let data = new TextEncoder().encode(JSON.stringify(obj)); let z = 0;
    if (window.CompressionStream) { data = await Share.pipe(data, new CompressionStream('gzip')); z = 1; }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await Share.key(k), data));
    return `${z}.${Share.b64u(iv)}.${Share.bin(ct)}`;
  },
  async decrypt(str, k) {
    const [z, iv, ct] = str.split('.');
    let data;
    try { data = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Share.unb64u(iv) }, await Share.key(k), Uint8Array.from(atob(ct), (c) => c.charCodeAt(0)))); }
    catch (e) { throw new Error('הקישור לא תקין או שהמפתח שבו שגוי.'); }
    if (z === '1') data = await Share.pipe(data, new DecompressionStream('gzip'));
    return JSON.parse(new TextDecoder().decode(data));
  },
  // קריאה לשרת. מחזיר null כשהתקציב לא קיים, {same} כשלא השתנה, {conflict} כשמישהו העלה לפנינו
  async api(id, opts = {}) {
    let r;
    try { r = await fetch(`${Share.SITE}/api/share/${id}`, { cache: 'no-store', ...opts }); }
    catch (e) { throw new Error(FX.blockedHint() || 'אין חיבור לאינטרנט.'); }
    if (r.status === 404) return null;
    if (r.status === 304) return { same: true };
    if (r.status === 412) return { conflict: true };
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error === 'too-large' ? 'התקציב גדול מדי לשיתוף.' : body.error === 'forbidden' ? 'אין הרשאת עריכה לתקציב הזה.' : `שגיאת שרת (${r.status}).`);
    return body;
  },

  // ---------- מצב ומיזוג ----------
  role: (b = Registry.current()) => (b && b.share ? b.share.role : null),
  canWrite: (b = Registry.current()) => ['owner', 'editor'].includes(Share.role(b)),
  isOwner: (b = Registry.current()) => Share.role(b) === 'owner',
  // מצב התקציב הפתוח, בצורה שעולה לענן
  localState() {
    return { tx: S.tx, deleted: S.deleted || {}, stamps: S.stamps || {}, categories: S.categories, budgets: S.budgets, goals: S.goals,
      sources: S.sources, members: S.settings.members };
  },
  withMeta(state, b) { return { v: 2, name: b.name, kind: b.type || 'family', currency: b.currency || '₪', ...state, at: new Date().toISOString() }; },
  merge(local, remote) {
    const dead = { ...(remote.deleted || {}) };
    Object.entries(local.deleted || {}).forEach(([id, u]) => { if (!(dead[id] >= u)) dead[id] = u; });
    const byId = new Map();
    [...(remote.tx || []), ...(local.tx || [])].forEach((t) => { const o = byId.get(t.id); if (!o || (t.u || 0) > (o.u || 0)) byId.set(t.id, t); });
    const out = { tx: [...byId.values()].filter((t) => !(dead[t.id] >= (t.u || 0))), deleted: dead, stamps: {} };
    Share.SHARED_KEYS.forEach((k) => {
      const lu = (local.stamps || {})[k] || 0, ru = (remote.stamps || {})[k] || 0;
      const src = lu >= ru ? local : remote; out.stamps[k] = Math.max(lu, ru);
      if (k === 'settings') out.members = src.members || local.members; else out[k] = src[k] !== undefined ? src[k] : local[k];
    });
    return out;
  },
  // טביעה קצרה של מצב, כדי לדעת אם יש מה להעלות או להחיל
  sig(st) {
    const tx = (st.tx || []).map((t) => `${t.id}:${t.u || 0}`).sort().join(',');
    const del = Object.entries(st.deleted || {}).map(([k, v]) => `${k}:${v}`).sort().join(',');
    const stamps = Share.SHARED_KEYS.map((k) => (st.stamps || {})[k] || 0).join(',');
    return U.hash(`${tx}|${del}|${stamps}`);
  },
  // החלפת התקציב הפתוח במצב ממוזג (בלי לסמן את זה כשינוי מקומי)
  async apply(st) {
    Share.syncing = true;
    try {
      await DB.clear('tx'); S.tx = st.tx || []; if (S.tx.length) await DB.put('tx', S.tx);
      S.deleted = st.deleted || {}; S.stamps = st.stamps || {};
      ['categories', 'budgets', 'goals', 'sources'].forEach((k) => { if (st[k] !== undefined && !(k === 'categories' && !st[k].length)) S[k] = st[k]; });
      if (st.members) S.settings.members = st.members;
      for (const k of ['categories', 'budgets', 'goals', 'sources', 'settings', 'deleted', 'stamps']) await Store.save(k);
      Calc.relink();
    } finally { Share.syncing = false; }
  },

  // ---------- סנכרון (בעלים ועורכים) ----------
  syncBusy: false, syncAgain: false,
  changed() {
    if (Share.syncing || !Share.canWrite()) return;
    Registry.current().share.dirty = true;
    clearTimeout(Share.timer); Share.timer = setTimeout(() => Share.sync(), 800);
  },
  async sync(b = Registry.current()) {
    if (!Share.canWrite(b) || b.id !== Registry.last) return false;
    if (Share.syncBusy) { Share.syncAgain = true; return false; }
    Share.syncBusy = true; let changedHere = false;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const sh = b.share;
        const res = await Share.api(sh.id, sh.rev ? { headers: { 'If-None-Match': `"${sh.rev}"` } } : {});
        if (!res) {
          if (sh.rev) { sh.gone = true; await Registry.save(); return changedHere; } // השיתוף הופסק
        }
        let remote = null, rev = sh.rev;
        if (res && !res.same) { remote = await Share.decrypt(res.data, sh.key); rev = res.updated; }
        const local = Share.localState();
        const merged = remote ? Share.merge(local, remote) : local;
        if (remote && Share.sig(merged) !== Share.sig(local)) {
          await Share.apply(merged); changedHere = true;
          Object.assign(b, { name: remote.name || b.name });
        }
        const needPut = remote ? Share.sig(merged) !== Share.sig(remote) : (sh.dirty || !res);
        if (!needPut) { Object.assign(sh, { rev, dirty: false, pending: false, gone: false, error: null, updated: rev }); await Registry.save(); return changedHere; }
        const data = await Share.encrypt(Share.withMeta(merged, b), sh.key);
        const headers = { Authorization: `Bearer ${sh.token}`, 'Content-Type': 'application/json' };
        if (res && rev) headers['If-Match'] = `"${rev}"`;
        const put = await Share.api(sh.id, { method: 'PUT', headers, body: JSON.stringify({ data }) });
        if (put && put.conflict) continue; // מישהו העלה ממש עכשיו: ממזגים שוב
        Object.assign(sh, { rev: put.updated, updated: put.updated, published: put.updated, dirty: false, pending: false, gone: false, error: null });
        await Registry.save();
        return changedHere;
      }
    } catch (e) {
      b.share.pending = true; b.share.error = e.message; await Registry.save();
    } finally {
      Share.syncBusy = false;
      if (Share.syncAgain) { Share.syncAgain = false; setTimeout(() => Share.sync(), 200); }
    }
    return changedHere;
  },

  // ---------- יצירת שיתוף (גם לתקציב שלא פתוח כרגע) ----------
  readDb(name) {
    return new Promise((res, rej) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => { const db = req.result; db.createObjectStore('tx', { keyPath: 'id' }); db.createObjectStore('kv', { keyPath: 'key' }); };
      req.onerror = () => rej(req.error);
      req.onsuccess = () => {
        const db = req.result; const t = db.transaction(['tx', 'kv'], 'readonly');
        const tx = t.objectStore('tx').getAll(), kv = t.objectStore('kv').getAll();
        t.oncomplete = () => { db.close(); const o = {}; kv.result.forEach((r) => { o[r.key] = r.value; }); res({ tx: tx.result, kv: o }); };
        t.onerror = () => { db.close(); rej(t.error); };
      };
    });
  },
  async stateOf(b) {
    if (b.id === Registry.last && DB.db) return Share.localState();
    const { tx, kv } = await Share.readDb(b.db);
    return { tx, deleted: kv.deleted || {}, stamps: kv.stamps || {}, categories: kv.categories || [], budgets: kv.budgets || {}, goals: kv.goals || [],
      sources: kv.sources || [], members: (kv.settings || {}).members || ['משותף'] };
  },
  async start(b = Registry.current()) {
    b.share = { role: 'owner', id: Share.rand(16), key: Share.rand(32), token: Share.rand(32) };
    await Registry.save();
    try {
      const data = await Share.encrypt(Share.withMeta(await Share.stateOf(b), b), b.share.key);
      const put = await Share.api(b.share.id, { method: 'PUT', headers: { Authorization: `Bearer ${b.share.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
      Object.assign(b.share, { rev: put.updated, updated: put.updated, published: put.updated });
      await Registry.save();
    } catch (e) { delete b.share; await Registry.save(); throw e; }
  },
  async stop(b = Registry.current()) {
    await Share.api(b.share.id, { method: 'DELETE', headers: { Authorization: `Bearer ${b.share.token}` } });
    delete b.share; await Registry.save();
  },
  async leave(b) {
    await Registry.remove(b.id);
  },
  link: (b, edit) => `${Share.SITE}/join#${b.share.id}.${b.share.key}${edit ? `.${b.share.token}` : ''}`,
  async send(b, edit) {
    const link = Share.link(b, edit);
    const text = `${b.name}: תקציב משותף ${edit ? 'לעריכה' : 'לצפייה'} באפליקציית תקציב משפחתי\n${link}`;
    if (Platform.android() && window.AndroidBridge.shareText) return window.AndroidBridge.shareText(text);
    if (navigator.share) { try { await navigator.share({ title: b.name, text, url: link }); return; } catch (e) { /* בוטל */ } }
    try { await navigator.clipboard.writeText(link); UI.toast('הקישור הועתק'); } catch (e) { UI.toast('העתיקו את הקישור מהחלון.'); }
  },
  dialog(b = Registry.current()) {
    const role = Share.role(b);
    if (!role) {
      return UI.modal({
        title: `שיתוף: ${b.name}`,
        body: `<div class="stack"><p>יוצרים קישור ושולחים אותו (למשל בוואטסאפ). מי שלוחץ עליו מקבל את התקציב "${U.esc(b.name)}" באפליקציה שלו, וכל שינוי מופיע אצל כולם תוך כמה שניות.</p>
          <p>אפשר לשלוח <strong>קישור לצפייה</strong> (רואים בלבד) או <strong>קישור לעריכה</strong> (מוסיפים, עורכים ומוחקים).</p>
          <p class="caption">${UI.icon('shield')} התקציב מוצפן בטלפון לפני שהוא עולה לענן. מפתח הפענוח נמצא רק בקישור.</p></div>`,
        actions: [{ label: 'יצירת שיתוף', cls: 'primary', onClick: async (close) => {
          try { await Share.start(b); close(); App.render(); Share.dialog(b); } catch (e) { UI.error(e); }
        } }, { label: 'ביטול', cls: 'ghost', onClick: (close) => close() }],
      });
    }
    const sh = b.share; const when = sh.updated || sh.published;
    const status = sh.gone ? '<span class="over">השיתוף הופסק.</span>' : sh.pending ? '<span class="warn">יש שינויים שעוד לא עלו לענן. הם יעלו כשתהיה רשת.</span>'
      : when ? `מסונכרן עם הענן: <span class="num">${new Date(when).toLocaleString('he-IL')}</span>` : '';
    const linkRow = (edit) => `<div class="stack" style="gap:6px"><span class="label">${edit ? `${UI.icon('pencil')} קישור לעריכה` : `${UI.icon('eye')} קישור לצפייה`}</span>
      <div class="row" style="flex-wrap:nowrap"><input readonly class="sh-link" value="${U.esc(Share.link(b, edit))}" dir="ltr" style="flex:1;min-width:0">
      <button class="btn sm primary" data-send="${edit ? 'edit' : 'view'}">${UI.icon('send')}שליחה</button></div></div>`;
    const m = UI.modal({
      title: `שיתוף: ${b.name}`,
      body: `<div class="stack">
        <p>${role === 'owner' ? 'התקציב משותף.' : 'קיבלתם את התקציב הזה בקישור לעריכה.'} כל שינוי מופיע אצל כל המשתתפים תוך כמה שניות.</p>
        ${linkRow(false)}${role !== 'viewer' ? linkRow(true) : ''}
        <p class="caption">${status}</p>
        <p class="caption">${UI.icon('shield')} כל מי שמחזיק קישור עריכה יכול לשנות ולמחוק בתקציב. שלחו אותו רק למי שאתם סומכים עליו.</p></div>`,
      actions: [
        { label: 'סגירה', cls: 'ghost', onClick: (close) => close() },
        ...(role === 'owner' ? [{ label: 'הפסקת השיתוף לכולם', cls: 'danger', onClick: async (close) => {
          if (!(await UI.confirm('להפסיק לשתף? כל מי שקיבל קישור יישאר עם העותק האחרון ולא יקבל עוד עדכונים.', 'הפסקה', true))) return;
          try { await Share.stop(b); close(); UI.toast('השיתוף הופסק'); App.render(); } catch (e) { UI.error(e); }
        } }] : []),
      ],
    });
    $$('.sh-link', m.el).forEach((i) => (i.onclick = () => i.select()));
    $$('[data-send]', m.el).forEach((btn) => (btn.onclick = () => Share.send(b, btn.dataset.send === 'edit')));
  },

  // ---------- הצטרפות וצפייה ----------
  parse(text) {
    const m = String(text || '').match(/([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]{40,50})(?:\.([A-Za-z0-9_-]{40,50}))?\s*$/);
    return m ? { id: m[1], key: m[2], token: m[3] || null } : null;
  },
  async fetchSnap(id, key, since = null) {
    const res = await Share.api(id, since ? { headers: { 'If-None-Match': `"${since}"` } } : {});
    if (!res) return null;
    if (res.same) return { same: true };
    return { snap: await Share.decrypt(res.data, key), updated: res.updated };
  },
  async join(text) {
    const p = Share.parse(text);
    if (!p) return UI.toast('זה לא נראה כמו קישור שיתוף של האפליקציה.', 'error');
    const have = Registry.list.find((b) => b.share && b.share.id === p.id);
    if (have) {
      // קישור עריכה לתקציב שכבר קיים לצפייה: משדרגים להרשאת עריכה
      if (p.token && have.share.role === 'viewer') { Object.assign(have.share, { role: 'editor', token: p.token }); await Registry.save(); UI.toast(`"${have.name}" פתוח עכשיו גם לעריכה`); }
      else UI.toast(`"${have.name}" כבר נמצא אצלכם`);
      return App.openBudget(have.id);
    }
    let got;
    try { got = await Share.fetchSnap(p.id, p.key); } catch (e) { return UI.error(e); }
    if (!got) return UI.toast('התקציב הזה כבר לא משותף.', 'error');
    const b = await Registry.add(got.snap.name, got.snap.kind || 'family', got.snap.currency || '₪');
    b.share = p.token ? { role: 'editor', id: p.id, key: p.key, token: p.token, rev: got.updated, updated: got.updated }
      : { role: 'viewer', id: p.id, key: p.key };
    await Registry.save();
    UI.toast(`התקציב "${b.name}" נוסף ${p.token ? 'לעריכה' : 'לצפייה'}`);
    await App.openBudget(b.id, got);
  },
  // מחליף את העותק המקומי בעותק מהענן (בהצטרפות, ובתקציב לצפייה)
  async pull(b, got = null) {
    try { got = got || await Share.fetchSnap(b.share.id, b.share.key); }
    catch (e) { b.share.error = e.message; return false; }
    if (!got) { b.share.gone = true; await Registry.save(); return false; }
    if (got.same) return false;
    const s = got.snap;
    await Share.apply({ tx: s.tx, deleted: s.deleted, stamps: s.stamps, categories: s.categories, budgets: s.budgets || {}, goals: s.goals || [], sources: s.sources || [], members: s.members });
    Object.assign(b, { name: s.name || b.name, type: s.kind || b.type, currency: s.currency || b.currency });
    Object.assign(b.share, { updated: got.updated, rev: got.updated, gone: false, error: null });
    await Registry.save();
    return true;
  },
  banner() {
    const b = Registry.current(); const sh = (b && b.share) || {};
    if (!sh.role) return '';
    const when = sh.updated ? new Date(sh.updated).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '';
    if (sh.role !== 'viewer') {
      if (!sh.gone && !sh.pending) return '';
      return `<div class="alert ${sh.gone ? 'over' : 'warn'} no-print" style="margin-bottom:16px">${UI.icon(sh.gone ? 'unlink' : 'cloud-off')}<div class="grow">${sh.gone ? 'השיתוף הופסק. התקציב נשאר אצלכם, אבל כבר לא מסונכרן.' : 'יש שינויים שעוד לא עלו לענן. הם יעלו כשתהיה רשת.'}</div></div>`;
    }
    const note = sh.gone ? 'השיתוף הופסק. מוצג העותק האחרון.' : sh.error ? `לא ניתן לעדכן עכשיו (${sh.error}). מוצג העותק האחרון.` : when ? `עודכן לאחרונה: ${when}` : '';
    return `<div class="alert info no-print ro-banner" style="margin-bottom:16px">${UI.icon('eye')}<div class="grow"><strong>צפייה בלבד.</strong> ${U.esc(note)}</div>
      ${sh.gone ? '' : '<button class="btn sm" data-ro-refresh>רענון</button>'}</div>`;
  },

  // ---------- עדכון חי ----------
  LIVE_MS: 8000, liveTimer: null, liveBusy: false,
  live() {
    clearInterval(Share.liveTimer);
    Share.liveTimer = setInterval(Share.tick, Share.LIVE_MS);
    // כשחוזרים לאפליקציה בודקים מיד, בלי לחכות לסבב הבא
    if (!Share.liveBound) { Share.liveBound = true; document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Share.tick(); }); }
  },
  refreshScreen() { if (!$('.modal-back')) { const y = window.scrollY; App.render(); window.scrollTo(0, y); } },
  async tick() {
    const b = Registry.current();
    if (!b || !b.share || b.share.gone || Share.liveBusy || document.visibilityState !== 'visible' || $('#app').hidden) return;
    Share.liveBusy = true;
    try {
      if (Share.canWrite(b)) {
        if (await Share.sync(b)) { Share.refreshScreen(); UI.toast('התקציב עודכן'); }
        else if (b.share.gone) App.render();
        return;
      }
      const got = await Share.fetchSnap(b.share.id, b.share.key, b.share.updated);
      if (!got) { b.share.gone = true; await Registry.save(); App.render(); return; }
      if (got.same || Registry.current() !== b) return;
      await Share.pull(b, got);
      Share.refreshScreen(); UI.toast('התקציב עודכן');
    } catch (e) { /* בלי רשת: מנסים שוב בפעם הבאה */ } finally { Share.liveBusy = false; }
  },
  // קישור שהגיע מבחוץ (נפתח באפליקציה או בדפדפן)
  incoming() {
    let link = '';
    if (location.hash.startsWith('#join=')) { link = decodeURIComponent(location.hash.slice(6)); history.replaceState(null, '', location.pathname); }
    if (!link && Platform.android() && window.AndroidBridge.takeLink) link = window.AndroidBridge.takeLink() || '';
    if (link) Share.join(link);
  },
};
