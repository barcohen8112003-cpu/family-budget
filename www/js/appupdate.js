'use strict';
/* עדכון האפליקציה עצמה: כשיש APK חדש בשרת מופיע פס "עדכון", ולחיצה מורידה ומתקינה אותו.
   מהגרסה הראשונה שיודעת לעשות את זה (1.5), כל עדכון הבא מגיע כך, בלי התקנה ידנית. */

const AppUpd = {
  info: null, busy: false,
  bridge: () => Platform.android() && typeof window.AndroidBridge.installUpdate === 'function',
  local: () => (AppUpd.bridge() ? window.AndroidBridge.appVersionCode() : 0),
  versionName: () => (typeof window.AndroidBridge.appVersionName === 'function' ? window.AndroidBridge.appVersionName() : `1.${AppUpd.local() - 1}`), // 1.5 עדיין לא מדווחת שם גרסה
  // מחזיר 'update' כשיש גרסה חדשה (ומציג את הפס), 'latest' או 'offline'
  // גרסה ישנה (לפני 1.4) חוסמת פנייה לשרת, אז אי אפשר לבדוק בה עדכונים. מציגים לה את ההוראות ישר
  old: () => Platform.android() && !(window.AndroidBridge.apiVersion && window.AndroidBridge.apiVersion() >= 2),
  async check() {
    if (!Platform.android()) return 'latest';
    if (AppUpd.old()) { AppUpd.info = null; AppUpd.bar(); return 'update'; }
    try {
      const endpoint = (typeof Admin !== 'undefined' && Admin.isActive()) ? `${Share.SITE}/api/app-admin` : `${Share.SITE}/api/app`;
      const r = await fetch(endpoint, { cache: 'no-store' });
      if (!r.ok) return 'offline';
      AppUpd.info = await r.json();
      if (!AppUpd.bridge() || AppUpd.info.versionCode > AppUpd.local()) { AppUpd.bar(); return 'update'; }
      return 'latest';
    } catch (e) { return 'offline'; }
  },
  bar(text) {
    let el = $('#upd-bar');
    if (!el) { el = document.createElement('div'); el.id = 'upd-bar'; el.className = 'upd-bar no-print'; document.body.appendChild(el); }
    const i = AppUpd.info;
    const label = i ? `<strong>גרסה חדשה של האפליקציה (${U.esc(i.versionName)})</strong><div class="caption" style="color:inherit">${(i.size / 1048576).toFixed(1)} MB · כל הנתונים נשמרים</div>`
      : '<strong>צריך לעדכן את האפליקציה</strong><div class="caption" style="color:inherit">התקנה אחת, ומאז העדכונים יגיעו לבד. הנתונים נשמרים.</div>';
    el.innerHTML = `${UI.icon('download')}<div class="grow">${text || label}</div>
      ${text ? '' : '<button class="btn sm primary" data-upd>עדכון</button><button class="btn sm ghost icon" data-upd-later aria-label="אחר כך">' + UI.icon('x') + '</button>'}`;
    UI.icons();
    const go = $('[data-upd]', el); if (go) go.onclick = AppUpd.start;
    const later = $('[data-upd-later]', el); if (later) later.onclick = () => el.remove();
  },
  start() {
    if (!AppUpd.bridge()) {
      // גרסה ישנה בלי עדכון מתוך האפליקציה: התקנה ידנית אחרונה
      return UI.modal({
        title: 'עדכון האפליקציה',
        body: `<div class="stack"><p>הגרסה שמותקנת אצלכם עוד לא יודעת להתעדכן לבד. צריך להתקין פעם אחת את הגרסה החדשה, ומאז העדכונים יגיעו בלחיצה.</p>
          <ol style="margin:0;padding-inline-start:20px;line-height:28px"><li>לחצו "העתקת הקישור".</li><li>פתחו את הדפדפן בטלפון (Chrome) והדביקו את הקישור בשורת הכתובת.</li>
            <li>הקובץ יורד. פתחו אותו ולחצו "התקנה". הנתונים נשמרים.</li></ol>
          <input readonly dir="ltr" id="apk-url" value="${Share.SITE}/apk/family-budget.apk" onclick="this.select()"></div>`,
        actions: [{ label: 'העתקת הקישור', cls: 'primary', onClick: async (close, el) => {
          const inp = $('#apk-url', el); inp.select();
          let ok = false;
          try { await navigator.clipboard.writeText(inp.value); ok = true; } catch (e) { try { ok = document.execCommand('copy'); } catch (e2) { /* לא נתמך */ } }
          UI.toast(ok ? 'הקישור הועתק. עכשיו פתחו את הדפדפן והדביקו.' : 'סמנו את הקישור והעתיקו אותו ידנית.');
        } }, { label: 'סגירה', cls: 'ghost', onClick: (close) => close() }],
      });
    }
    if (!window.AndroidBridge.canInstall()) {
      return UI.modal({
        title: 'אישור חד-פעמי',
        body: `<p>כדי שהאפליקציה תוכל להתקין את העדכונים שלה, אנדרואיד מבקש לאשר פעם אחת "התקנת אפליקציות לא מוכרות" עבור תקציב משפחתי.</p>
          <p class="caption">במסך שייפתח הפעילו את האפשרות, חזרו לכאן ולחצו שוב "עדכון".</p>`,
        actions: [{ label: 'למסך האישור', cls: 'primary', onClick: (close) => { close(); window.AndroidBridge.openInstallPermission(); } },
          { label: 'ביטול', cls: 'ghost', onClick: (close) => close() }],
      });
    }
    if (AppUpd.busy) return;
    AppUpd.busy = true; AppUpd.bar('מוריד את העדכון…');
    window.AndroidBridge.installUpdate(AppUpd.info.sha256);
  },
  // מצב מהצד של אנדרואיד
  status(state, message) {
    if (state === 'downloading') AppUpd.bar('מוריד את העדכון…');
    else if (state === 'confirm') AppUpd.bar('אשרו את העדכון בחלון של אנדרואיד. האפליקציה תיסגר ותיפתח מעודכנת.');
    else {
      AppUpd.busy = false; AppUpd.bar();
      UI.toast(state === 'cancelled' ? 'העדכון בוטל' : `העדכון לא הצליח: ${message || 'שגיאה לא ידועה'}`, state === 'cancelled' ? '' : 'error');
    }
  },
};
