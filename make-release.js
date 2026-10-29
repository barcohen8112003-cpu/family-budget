// מפרסם את ה-APK שנבנה: מעתיק אותו ל-www/apk ויוצר version.json עם מספר הגרסה, הגודל והגיבוב.
// אחרי דחיפה ל-GitHub, האפליקציות המותקנות מציעות את העדכון בעצמן.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const apk = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const gradle = fs.readFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'utf8');
const versionCode = +gradle.match(/versionCode\s+(\d+)/)[1];
const versionName = gradle.match(/versionName\s+'([^']+)'/)[1];
const data = fs.readFileSync(apk);
const out = path.join(root, 'www', 'apk');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(apk, path.join(out, 'family-budget.apk'));
fs.copyFileSync(apk, path.join(root, 'family-budget.apk'));
const info = { versionCode, versionName, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), date: new Date().toISOString().slice(0, 10) };
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify(info, null, 1));
console.log(`release ${versionName} (${versionCode}), ${(data.length / 1048576).toFixed(2)} MB`);
