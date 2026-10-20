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
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
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
      return share ? json(share) : json({ error: 'not-found' }, 404);
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
      const share = { data: body.data, updated: new Date().toISOString() };
      if (!owner) await storage.put('owner', hash);
      await storage.put('share', share);
      return json({ ok: true, updated: share.updated });
    }
    return json({ error: 'method' }, 405);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
