// מפרסם את ה-APK שנבנה: מעתיק אותו ל-www/apk ויוצר version.json עם מספר הגרסה, הגודל והגיבוב.
// מעבד גם את גרסת המשתמשים (family-budget.apk) וגם את גרסת האדמין (family-budget-admin.apk).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const gradle = fs.readFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'utf8');
const versionCode = +gradle.match(/versionCode\s+(\d+)/)[1];
const versionName = gradle.match(/versionName\s+'([^']+)'/)[1];
const out = path.join(root, 'www', 'apk');
fs.mkdirSync(out, { recursive: true });

// 1. קובץ משתמשים רגיל
const regularCandidates = [
  path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'regular', 'debug', 'app-regular-debug.apk'),
  path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
];
const regularApk = regularCandidates.find(p => fs.existsSync(p));

if (regularApk) {
  const data = fs.readFileSync(regularApk);
  fs.copyFileSync(regularApk, path.join(out, 'family-budget.apk'));
  fs.copyFileSync(regularApk, path.join(root, 'family-budget.apk'));
  const info = { versionCode, versionName, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), date: new Date().toISOString().slice(0, 10) };
  fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify(info, null, 1));
  console.log(`[Users APK] release ${versionName} (${versionCode}), ${(data.length / 1048576).toFixed(2)} MB -> family-budget.apk`);
}

// 2. קובץ אדמין ייעודי
const adminApk = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'admin', 'debug', 'app-admin-debug.apk');
if (fs.existsSync(adminApk)) {
  const adminData = fs.readFileSync(adminApk);
  fs.copyFileSync(adminApk, path.join(out, 'family-budget-admin.apk'));
  fs.copyFileSync(adminApk, path.join(root, 'family-budget-admin.apk'));
  const adminInfo = { role: 'admin', versionCode, versionName, size: adminData.length, sha256: crypto.createHash('sha256').update(adminData).digest('hex'), date: new Date().toISOString().slice(0, 10) };
  fs.writeFileSync(path.join(out, 'version-admin.json'), JSON.stringify(adminInfo, null, 1));
  console.log(`[Admin APK] release ${versionName} (${versionCode}), ${(adminData.length / 1048576).toFixed(2)} MB -> family-budget-admin.apk`);
}
