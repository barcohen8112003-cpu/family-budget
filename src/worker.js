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
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, If-Match',
  'Access-Control-Max-Age': '86400',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } });

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class ShareStore extends DurableObject {
  async fetch(request) {
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
    if (url.pathname === '/api/rate') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      return rates(ctx);
    }
    if (url.pathname === '/.well-known/assetlinks.json') {
      return json([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: APP_ID, sha256_cert_fingerprints: [APP_CERT] } }]);
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
