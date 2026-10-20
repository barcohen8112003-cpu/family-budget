'use strict';
/* שיתוף תקציב בקישור, לצפייה בלבד.
   הבעלים מצפין את התקציב בטלפון ומעלה אותו לשרת עם אסימון כתיבה שרק אצלו.
   הקישור מכיל מזהה ומפתח פענוח אחרי הסימן #, ולכן המפתח לא נשלח לשרת לעולם. */

const Share = {
  SITE: 'https://family-budget.naorkurtz1.workers.dev',
  syncing: false, timer: null,

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
  async api(id, opts = {}) {
    let r;
    try { r = await fetch(`${Share.SITE}/api/share/${id}`, { cache: 'no-store', ...opts }); }
    catch (e) { throw new Error(FX.blockedHint() || 'אין חיבור לאינטרנט.'); }
    if (r.status === 404) return null;
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error === 'too-large' ? 'התקציב גדול מדי לשיתוף.' : `שגיאת שרת (${r.status}).`);
    return body;
  },

  // ---------- בעלים ----------
  snapshot() {
    return { v: 1, name: Registry.current().name, kind: App.kind, currency: U.cur, tx: S.tx, categories: S.categories, budgets: S.budgets,
      goals: S.goals, sources: S.sources, members: S.settings.members, at: new Date().toISOString() };
  },
  link: (b) => `${Share.SITE}/join#${b.share.id}.${b.share.key}`,
  isOwner: () => { const b = Registry.current(); return !!(b && b.share && b.share.role === 'owner'); },
  async start() {
    const b = Registry.current();
    b.share = { role: 'owner', id: Share.rand(16), key: Share.rand(32), token: Share.rand(32) };
    await Registry.save();
    await Share.publish(true);
  },
  async publish(throwErrors = false) {
    const b = Registry.current(); if (!b || !b.share || b.share.role !== 'owner') return;
    try {
      const data = await Share.encrypt(Share.snapshot(), b.share.key);
      const res = await Share.api(b.share.id, { method: 'PUT', headers: { Authorization: `Bearer ${b.share.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
      b.share.published = res && res.updated; b.share.pending = false;
    } catch (e) {
      b.share.pending = true;
      if (throwErrors) { await Registry.save(); throw e; }
    }
    await Registry.save();
  },
  // אחרי כל שינוי בתקציב משותף: העלאה מחדש (מאוחדת לשינויים רצופים)
  changed() {
    if (Share.syncing || !Share.isOwner()) return;
    clearTimeout(Share.timer); Share.timer = setTimeout(() => Share.publish(), 1500);
  },
  async stop() {
    const b = Registry.current();
    await Share.api(b.share.id, { method: 'DELETE', headers: { Authorization: `Bearer ${b.share.token}` } });
    delete b.share; await Registry.save();
  },
  async send() {
    const b = Registry.current(); const link = Share.link(b);
    const text = `${b.name}: תקציב לצפייה באפליקציית תקציב משפחתי\n${link}`;
    if (Platform.android() && window.AndroidBridge.shareText) return window.AndroidBridge.shareText(text);
    if (navigator.share) { try { await navigator.share({ title: b.name, text, url: link }); return; } catch (e) { /* בוטל */ } }
    try { await navigator.clipboard.writeText(link); UI.toast('הקישור הועתק'); } catch (e) { UI.toast('העתיקו את הקישור מהחלון.'); }
  },
  dialog() {
    const b = Registry.current(); const shared = Share.isOwner();
    const m = UI.modal({
      title: 'שיתוף התקציב',
      body: shared
        ? `<div class="stack"><p>מי שמקבל את הקישור רואה את התקציב באפליקציה שלו, ומקבל כל שינוי שתעשו. הוא לא יכול לשנות כלום.</p>
          <label class="field"><span>הקישור</span><input id="sh-link" readonly value="${U.esc(Share.link(b))}" dir="ltr"></label>
          <p class="caption">${b.share.pending ? '<span class="warn">השינויים האחרונים עוד לא הועלו. הם יועלו כשתהיה רשת.</span>' : b.share.published ? `עודכן בשרת: <span class="num">${new Date(b.share.published).toLocaleString('he-IL')}</span>` : ''}</p>
          <p class="caption">${UI.icon('shield')} כל מי שמחזיק את הקישור יכול לראות את התקציב. שלחו אותו רק למי שאתם סומכים עליו.</p></div>`
        : `<div class="stack"><p>יוצרים קישור ושולחים אותו (למשל בוואטסאפ). מי שלוחץ עליו מקבל את התקציב באפליקציה שלו, לצפייה בלבד, וכל שינוי שתעשו יגיע אליו.</p>
          <p class="caption">${UI.icon('shield')} התקציב מוצפן בטלפון שלכם לפני שהוא עולה לשרת. מפתח הפענוח נמצא רק בקישור.</p></div>`,
      actions: shared
        ? [{ label: 'שליחת הקישור', cls: 'primary', onClick: () => Share.send() },
          { label: 'סגירה', cls: 'ghost', onClick: (close) => close() },
          { label: 'הפסקת השיתוף', cls: 'danger', onClick: async (close) => {
            if (!(await UI.confirm('להפסיק לשתף? מי שקיבל את הקישור יישאר עם העותק האחרון ולא יקבל עוד עדכונים.', 'הפסקה', true))) return;
            try { await Share.stop(); close(); UI.toast('השיתוף הופסק'); App.render(); } catch (e) { UI.error(e); }
          } }]
        : [{ label: 'יצירת קישור', cls: 'primary', onClick: async (close) => {
          try { await Share.start(); close(); Share.dialog(); } catch (e) { UI.error(e); }
        } }, { label: 'ביטול', cls: 'ghost', onClick: (close) => close() }],
    });
    const inp = $('#sh-link', m.el); if (inp) inp.onclick = () => inp.select();
  },

  // ---------- צופה ----------
  parse(text) {
    const m = String(text || '').match(/([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]{40,50})\s*$/);
    return m ? { id: m[1], key: m[2] } : null;
  },
  async fetchSnap(id, key) {
    const res = await Share.api(id);
    if (!res) return null;
    return { snap: await Share.decrypt(res.data, key), updated: res.updated };
  },
  async join(text) {
    const p = Share.parse(text);
    if (!p) return UI.toast('זה לא נראה כמו קישור שיתוף של האפליקציה.', 'error');
    const have = Registry.list.find((b) => b.share && b.share.id === p.id);
    if (have) { UI.toast(`"${have.name}" כבר נמצא אצלכם`); return App.openBudget(have.id); }
    let got;
    try { got = await Share.fetchSnap(p.id, p.key); } catch (e) { return UI.error(e); }
    if (!got) return UI.toast('התקציב הזה כבר לא משותף.', 'error');
    const b = await Registry.add(got.snap.name, got.snap.kind || 'family', got.snap.currency || '₪');
    b.share = { role: 'viewer', id: p.id, key: p.key }; await Registry.save();
    UI.toast(`התקציב "${b.name}" נוסף לצפייה`);
    await App.openBudget(b.id, got);
  },
  // מעדכן את העותק המקומי של תקציב לצפייה. got: תוצאה שכבר נמשכה (בהצטרפות)
  async pull(b, got = null) {
    try { got = got || await Share.fetchSnap(b.share.id, b.share.key); }
    catch (e) { b.share.error = e.message; return false; }
    if (!got) { b.share.gone = true; await Registry.save(); return false; }
    const s = got.snap;
    Share.syncing = true;
    try {
      await DB.clear('tx'); S.tx = s.tx || []; await DB.put('tx', S.tx);
      Object.assign(S, { categories: s.categories || S.categories, budgets: s.budgets || {}, goals: s.goals || [], sources: s.sources || [] });
      S.settings.members = s.members || S.settings.members;
      for (const k of ['categories', 'budgets', 'goals', 'sources', 'settings']) await Store.save(k);
      Calc.relink();
    } finally { Share.syncing = false; }
    Object.assign(b, { name: s.name || b.name, type: s.kind || b.type, currency: s.currency || b.currency });
    Object.assign(b.share, { updated: got.updated, gone: false, error: null });
    await Registry.save();
    return true;
  },
  banner() {
    const b = Registry.current(); const sh = b.share || {};
    const when = sh.updated ? new Date(sh.updated).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '';
    const note = sh.gone ? 'הבעלים הפסיק לשתף. מוצג העותק האחרון.' : sh.error ? `לא ניתן לעדכן עכשיו (${sh.error}). מוצג העותק האחרון.` : when ? `עודכן לאחרונה: ${when}` : '';
    return `<div class="alert info no-print ro-banner" style="margin-bottom:16px">${UI.icon('eye')}<div class="grow"><strong>צפייה בלבד.</strong> ${U.esc(note)}</div>
      ${sh.gone ? '' : '<button class="btn sm" data-ro-refresh>רענון</button>'}</div>`;
  },
  // קישור שהגיע מבחוץ (נפתח באפליקציה או בדפדפן)
  incoming() {
    let link = '';
    if (location.hash.startsWith('#join=')) { link = decodeURIComponent(location.hash.slice(6)); history.replaceState(null, '', location.pathname); }
    if (!link && Platform.android() && window.AndroidBridge.takeLink) link = window.AndroidBridge.takeLink() || '';
    if (link) Share.join(link);
  },
};
