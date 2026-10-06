// יוצר www/manifest.json: רשימת קובצי האפליקציה עם גיבוב SHA-256 לכל אחד.
// ה-APK משווה אותה לקבצים שיש אצלו ומוריד רק את מה שהשתנה.
// רץ אוטומטית בכל פריסה ל-Cloudflare (ראו wrangler.jsonc) ובכל בניית APK.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, 'www');
const files = {};
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) return walk(full);
  const rel = path.relative(root, full).split(path.sep).join('/');
  if (rel === 'manifest.json') return;
  files[rel] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
});
walk(root);
const version = crypto.createHash('sha256').update(JSON.stringify(Object.entries(files).sort())).digest('hex').slice(0, 12);
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ version, files }, null, 1));
console.log(`manifest ${version}: ${Object.keys(files).length} files`);
