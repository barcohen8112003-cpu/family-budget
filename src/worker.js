// שרת השיתוף: שומר עותק מוצפן של תקציב משותף ומגיש את קובצי האפליקציה.
// השרת לא יכול לקרוא את התקציבים: הם מוצפנים בטלפון של הבעלים, והמפתח נמצא רק בקישור השיתוף.
// כתיבה מותרת רק למי שמחזיק את אסימון הכתיבה (הבעלים); כל השאר יכולים רק לקרוא.
import { DurableObject } from 'cloudflare:workers';

const MAX_BYTES = 1_500_000;
const APP_ID = 'il.family.budget';
// טביעת האצבע של מפתח החתימה של ה-APK, כדי שקישורי שיתוף ייפתחו ישר באפליקציה
const APP_CERT = 'C6:2F:1C:98:AC:1B:61:28:BA:1A:EC:CF:10:47:52:D3:EA:A0:03:2B:69:0C:2E:08:88:D0:DD:66:A2:8F:51:09';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, If-Match',
  'Access-Control-Max-Age': '86400',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } });

const ADMIN_SECRET = 'family-admin-2026';

function checkAdminAuth(request) {
  const url = new URL(request.url);
  const auth = (request.headers.get('Authorization') || '').replace(/^Bearer /, '').trim();
  const queryToken = url.searchParams.get('token') || '';
  return auth === ADMIN_SECRET || queryToken === ADMIN_SECRET;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class ShareStore extends DurableObject {
  initSql() {
    if (!this.ctx.storage.sql) return false;
    if (this._sqlInited) return true;
    try {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          name TEXT,
          last_active TEXT
        );
        CREATE TABLE IF NOT EXISTS budgets (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          user_name TEXT,
          name TEXT,
          type TEXT,
          currency TEXT,
          tx_count INTEGER,
          month_expenses REAL,
          month_income REAL,
          updated TEXT,
          data TEXT
        );
      `);
      this._sqlInited = true;
      return true;
    } catch (e) {
      console.error('SQL init error:', e);
      return false;
    }
  }

  async handleSync(request) {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad-json' }, 400); }
    const { userId, userName, budget } = body;
    if (!userId || !budget || !budget.id) return json({ error: 'invalid-data' }, 400);

    const now = new Date().toISOString();
    const uname = (userName || 'משתמש').trim();
    const bId = String(budget.id);
    const bName = String(budget.name || 'ללא שם').trim();
    const bType = String(budget.type || 'family');
    const bCur = String(budget.currency || '₪');
    const txCount = Number(budget.txCount) || 0;
    const monthExp = Number(budget.monthExpenses) || 0;
    const monthInc = Number(budget.monthIncome) || 0;
    const updated = budget.updated || now;
    const dataStr = typeof budget.data === 'string' ? budget.data : JSON.stringify(budget.data || {});

    if (this.initSql()) {
      const sql = this.ctx.storage.sql;
      sql.exec(`
        INSERT INTO users (id, name, last_active) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, last_active=excluded.last_active;
      `, userId, uname, now);

      sql.exec(`
        INSERT INTO budgets (id, user_id, user_name, name, type, currency, tx_count, month_expenses, month_income, updated, data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          user_id=excluded.user_id,
          user_name=excluded.user_name,
          name=excluded.name,
          type=excluded.type,
          currency=excluded.currency,
          tx_count=excluded.tx_count,
          month_expenses=excluded.month_expenses,
          month_income=excluded.month_income,
          updated=excluded.updated,
          data=excluded.data;
      `, bId, userId, uname, bName, bType, bCur, txCount, monthExp, monthInc, updated, dataStr);
    } else {
      const users = (await this.ctx.storage.get('admin_users')) || {};
      users[userId] = { id: userId, name: uname, lastActive: now };
      await this.ctx.storage.put('admin_users', users);

      const metas = (await this.ctx.storage.get('admin_budgets_meta')) || {};
      metas[bId] = { id: bId, userId, userName: uname, name: bName, type: bType, currency: bCur, txCount, monthExpenses: monthExp, monthIncome: monthInc, updated };
      await this.ctx.storage.put('admin_budgets_meta', metas);
      await this.ctx.storage.put(`budget_data:${bId}`, dataStr);
    }

    return json({ ok: true, syncedAt: now });
  }

  async handleAdminOverview(request) {
    if (!checkAdminAuth(request)) return json({ error: 'unauthorized' }, 401);

    if (this.initSql()) {
      const sql = this.ctx.storage.sql;
      const usersRows = [...sql.exec(`SELECT id, name, last_active FROM users ORDER BY last_active DESC`)];
      const budgetRows = [...sql.exec(`SELECT id, user_id, user_name, name, type, currency, tx_count, month_expenses, month_income, updated FROM budgets ORDER BY updated DESC`)];

      let totalTx = 0, totalExpenses = 0, totalIncome = 0;
      const budgetsByUser = {};
      budgetRows.forEach((b) => {
        totalTx += Number(b.tx_count) || 0;
        totalExpenses += Number(b.month_expenses) || 0;
        totalIncome += Number(b.month_income) || 0;
        if (!budgetsByUser[b.user_id]) budgetsByUser[b.user_id] = [];
        budgetsByUser[b.user_id].push(b);
      });

      const users = usersRows.map((u) => ({
        userId: u.id,
        userName: u.name,
        lastActive: u.last_active,
        budgets: budgetsByUser[u.id] || []
      }));

      Object.keys(budgetsByUser).forEach((uid) => {
        if (!users.find((u) => u.userId === uid)) {
          const first = budgetsByUser[uid][0];
          users.push({
            userId: uid,
            userName: first.user_name || 'משתמש',
            lastActive: first.updated,
            budgets: budgetsByUser[uid]
          });
        }
      });

      return json({
        ok: true,
        summary: {
          totalUsers: users.length,
          totalBudgets: budgetRows.length,
          totalTx,
          totalMonthExpenses: totalExpenses,
          totalMonthIncome: totalIncome
        },
        users,
        allBudgets: budgetRows
      });
    } else {
      const usersMap = (await this.ctx.storage.get('admin_users')) || {};
      const metasMap = (await this.ctx.storage.get('admin_budgets_meta')) || {};
      const budgetRows = Object.values(metasMap);
      let totalTx = 0, totalExpenses = 0, totalIncome = 0;
      const budgetsByUser = {};
      budgetRows.forEach((b) => {
        totalTx += Number(b.txCount) || 0;
        totalExpenses += Number(b.monthExpenses) || 0;
        totalIncome += Number(b.monthIncome) || 0;
        if (!budgetsByUser[b.userId]) budgetsByUser[b.userId] = [];
        budgetsByUser[b.userId].push({
          id: b.id,
          user_id: b.userId,
          user_name: b.userName,
          name: b.name,
          type: b.type,
          currency: b.currency,
          tx_count: b.txCount,
          month_expenses: b.monthExpenses,
          month_income: b.monthIncome,
          updated: b.updated
        });
      });

      const users = Object.values(usersMap).map((u) => ({
        userId: u.id,
        userName: u.name,
        lastActive: u.lastActive,
        budgets: budgetsByUser[u.id] || []
      }));

      return json({
        ok: true,
        summary: {
          totalUsers: users.length,
          totalBudgets: budgetRows.length,
          totalTx,
          totalMonthExpenses: totalExpenses,
          totalMonthIncome: totalIncome
        },
        users,
        allBudgets: budgetRows
      });
    }
  }

  async handleAdminGetBudget(request, budgetId) {
    if (!checkAdminAuth(request)) return json({ error: 'unauthorized' }, 401);

    if (this.initSql()) {
      const sql = this.ctx.storage.sql;
      const rows = [...sql.exec(`SELECT id, user_id, user_name, name, type, currency, tx_count, month_expenses, month_income, updated, data FROM budgets WHERE id = ?`, budgetId)];
      if (!rows.length) return json({ error: 'not-found' }, 404);
      const row = rows[0];
      let data = {};
      try { data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data; } catch {}
      return json({
        ok: true,
        budget: {
          id: row.id,
          userId: row.user_id,
          userName: row.user_name,
          name: row.name,
          type: row.type,
          currency: row.currency,
          txCount: row.tx_count,
          monthExpenses: row.month_expenses,
          monthIncome: row.month_income,
          updated: row.updated,
          data
        }
      });
    } else {
      const metas = (await this.ctx.storage.get('admin_budgets_meta')) || {};
      const meta = metas[budgetId];
      if (!meta) return json({ error: 'not-found' }, 404);
      const rawData = await this.ctx.storage.get(`budget_data:${budgetId}`);
      let data = {};
      try { data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData; } catch {}
      return json({
        ok: true,
        budget: { ...meta, data }
      });
    }
  }

  async handleAdminDeleteBudget(request, budgetId) {
    if (!checkAdminAuth(request)) return json({ error: 'unauthorized' }, 401);
    if (this.initSql()) {
      this.ctx.storage.sql.exec(`DELETE FROM budgets WHERE id = ?`, budgetId);
    } else {
      const metas = (await this.ctx.storage.get('admin_budgets_meta')) || {};
      delete metas[budgetId];
      await this.ctx.storage.put('admin_budgets_meta', metas);
      await this.ctx.storage.delete(`budget_data:${budgetId}`);
    }
    return json({ ok: true });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/sync') {
      if (request.method === 'POST') return this.handleSync(request);
      return json({ error: 'method' }, 405);
    }
    if (url.pathname === '/api/admin/overview') {
      if (request.method === 'GET') return this.handleAdminOverview(request);
      return json({ error: 'method' }, 405);
    }
    const mBudget = url.pathname.match(/^\/api\/admin\/budget\/([A-Za-z0-9_-]+)$/);
    if (mBudget) {
      if (request.method === 'GET') return this.handleAdminGetBudget(request, mBudget[1]);
      if (request.method === 'DELETE') return this.handleAdminDeleteBudget(request, mBudget[1]);
      return json({ error: 'method' }, 405);
    }

    const storage = this.ctx.storage;
    const auth = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
    const owner = await storage.get('owner');
    if (request.method === 'GET') {
      const share = await storage.get('share');
      if (!share) return json({ error: 'not-found' }, 404);
      // הצופה שולח את גרסת העותק שלו; אם לא השתנה כלום, עונים בלי לשלוח את התקציב שוב
      if (request.headers.get('If-None-Match') === `"${share.updated}"`) return new Response(null, { status: 304, headers: CORS });
      return json(share);
    }
    if (!auth || auth.length < 32) return json({ error: 'unauthorized' }, 401);
    const hash = await sha256(auth);
    if (owner && owner !== hash) return json({ error: 'forbidden' }, 403);
    if (request.method === 'DELETE') {
      await storage.deleteAll();
      return json({ ok: true });
    }
    if (request.method === 'PUT') {
      const text = await request.text();
      if (text.length > MAX_BYTES) return json({ error: 'too-large' }, 413);
      let body;
      try { body = JSON.parse(text); } catch { return json({ error: 'bad-json' }, 400); }
      if (typeof body.data !== 'string') return json({ error: 'bad-body' }, 400);
      // מי שמעלה מצהיר על איזו גרסה הוא בנה; אם בינתיים מישהו אחר העלה, הוא צריך למזג קודם
      const ifMatch = request.headers.get('If-Match');
      if (ifMatch) {
        const cur = await storage.get('share');
        if (!cur || ifMatch !== `"${cur.updated}"`) return json({ error: 'conflict' }, 412);
      }
      const share = { data: body.data, updated: new Date().toISOString() };
      if (!owner) await storage.put('owner', hash);
      await storage.put('share', share);
      return json({ ok: true, updated: share.updated });
    }
    return json({ error: 'method' }, 405);
  }
}

// שערי מטבע: השער היציג של בנק ישראל (מתעדכן פעם ביום עסקים), עם גיבוי ממקור חינמי נוסף.
// התשובה נשמרת במטמון חצי שעה. השערים הם בשקלים ליחידת מטבע.
async function rates(ctx) {
  const cache = caches.default; const key = new Request('https://cache.internal/rates-v1');
  const hit = await cache.match(key); if (hit) return hit;
  let body = null;
  try {
    const r = await fetch('https://boi.org.il/PublicApi/GetExchangeRates', { headers: { Accept: 'application/json' } });
    const d = await r.json(); const out = {};
    d.exchangeRates.forEach((x) => { if (['USD', 'EUR', 'GBP'].includes(x.key)) out[x.key] = x.currentExchangeRate / (x.unit || 1); });
    const upd = d.exchangeRates.find((x) => x.key === 'USD').lastUpdate;
    if (out.USD) body = { rates: out, updated: upd, source: 'בנק ישראל (שער יציג)' };
  } catch (e) { /* נעבור לגיבוי */ }
  if (!body) {
    try {
      const d = await (await fetch('https://open.er-api.com/v6/latest/ILS')).json();
      const out = {}; ['USD', 'EUR', 'GBP'].forEach((k) => { if (d.rates[k]) out[k] = 1 / d.rates[k]; });
      body = { rates: out, updated: new Date(d.time_last_update_unix * 1000).toISOString(), source: 'open.er-api.com' };
    } catch (e) { return json({ error: 'rates-unavailable' }, 502); }
  }
  const res = new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800', ...CORS } });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // הגרסה האחרונה של ה-APK (מספר גרסה, גודל וגיבוב), כדי שהאפליקציה תדע להציע עדכון
    if (url.pathname === '/api/app') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      const r = await env.ASSETS.fetch(new Request(new URL('/apk/version.json', url)));
      if (!r.ok) return json({ error: 'no-release' }, 404);
      return json(await r.json());
    }
    if (url.pathname === '/api/app-admin') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      const r = await env.ASSETS.fetch(new Request(new URL('/apk/version-admin.json', url)));
      if (!r.ok) return json({ error: 'no-release' }, 404);
      return json(await r.json());
    }
    if (url.pathname === '/api/rate') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      return rates(ctx);
    }
    if (url.pathname === '/.well-known/assetlinks.json') {
      return json([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: APP_ID, sha256_cert_fingerprints: [APP_CERT] } }]);
    }
    if (url.pathname === '/api/sync' || url.pathname.startsWith('/api/admin')) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      return env.SHARES.get(env.SHARES.idFromName('__admin_store__')).fetch(request);
    }
    const m = url.pathname.match(/^\/api\/share\/([A-Za-z0-9_-]{16,64})$/);
    if (m) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      return env.SHARES.get(env.SHARES.idFromName(m[1])).fetch(request);
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'not-found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
