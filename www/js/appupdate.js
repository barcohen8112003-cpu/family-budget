'use strict';
/* עדכון האפליקציה עצמה: כשיש APK חדש בשרת מופיע פס "עדכון", ולחיצה מורידה ומתקינה אותו.
   מהגרסה הראשונה שיודעת לעשות את זה (1.5), כל עדכון הבא מגיע כך, בלי התקנה ידנית. */

const AppUpd = {
  info: null, busy: false,
  bridge: () => Platform.android() && typeof window.AndroidBridge.installUpdate === 'function',
  local: () => (AppUpd.bridge() ? window.AndroidBridge.appVersionCode() : 0),
  versionName: () => (typeof window.AndroidBridge.appVersionName === 'function' ? window.AndroidBridge.appVersionName() : `1.${AppUpd.local() - 1}`), // 1.5 עדיין לא מדווחת שם גרסה
  // מחזיר 'update' כשיש גרסה חדשה (ומציג את הפס), 'latest' או 'offline'
  async check() {
    if (!Platform.android()) return 'latest';
    try {
      const r = await fetch(`${Share.SITE}/api/app`, { cache: 'no-store' });
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
    el.innerHTML = `${UI.icon('download')}<div class="grow">${text || `<strong>גרסה חדשה של האפליקציה (${U.esc(i.versionName)})</strong><div class="caption" style="color:inherit">${(i.size / 1048576).toFixed(1)} MB · כל הנתונים נשמרים</div>`}</div>
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
          <p>פתחו בדפדפן של הטלפון את הכתובת הזאת, הורידו את הקובץ ולחצו "התקנה". הנתונים נשמרים.</p>
          <input readonly dir="ltr" value="${Share.SITE}/apk/family-budget.apk" onclick="this.select()"></div>`,
        actions: [{ label: 'הבנתי', cls: 'primary', onClick: (close) => close() }],
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
