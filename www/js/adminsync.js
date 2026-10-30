'use strict';
/* סנכרון אוטומטי של תקציבי המשתמש לענן כדי שהאדמין יוכל לצפות בהם */

const AdminSync = {
  timer: null,
  syncing: false,
  _hooked: false,
  _regHooked: false,

  getUserId() {
    let id = localStorage.getItem('fb_user_id');
    if (!id) {
      id = 'usr_' + U.uid();
      localStorage.setItem('fb_user_id', id);
    }
    return id;
  },

  getUserName() {
    let name = localStorage.getItem('fb_user_name');
    if (!name || !name.trim()) {
      if (typeof S !== 'undefined' && S.settings && S.settings.members && S.settings.members.length > 1) {
        name = S.settings.members[1];
      } else if (typeof Registry !== 'undefined' && Registry.current() && Registry.current().name && Registry.current().name !== 'תקציב משפחתי') {
        name = Registry.current().name;
      } else {
        name = 'משתמש ' + AdminSync.getUserId().slice(-4);
      }
    }
    return name.trim();
  },

  setUserName(name) {
    if (!name || !name.trim()) return;
    localStorage.setItem('fb_user_name', name.trim());
    AdminSync.schedule(100);
  },

  schedule(delay = 800) {
    clearTimeout(AdminSync.timer);
    AdminSync.timer = setTimeout(() => {
      AdminSync.syncCurrent().catch(() => {});
    }, delay);
  },

  async syncBudget(b) {
    if (!b) return;
    // אם האדמין צופה כרגע בתקציב של משתמש אחר, לא לדרוס את הנתונים
    if (typeof Admin !== 'undefined' && (Admin.viewingBudget || (Admin.isActive && Admin.isActive() && b.db && b.db.startsWith('family-budget-admin-view-')))) {
      return;
    }

    try {
      const state = await Share.stateOf(b);
      const curYm = U.today().slice(0, 7);
      let monthExpenses = 0, monthIncome = 0;
      (state.tx || []).forEach((t) => {
        if (t.date && t.date.slice(0, 7) === curYm) {
          if ((typeof Cat !== 'undefined' && Cat.isIncome(t.categoryId)) || t.amount > 0) {
            monthIncome += Math.abs(t.amount);
          } else {
            monthExpenses += Math.abs(t.amount);
          }
        }
      });

      const payload = {
        userId: AdminSync.getUserId(),
        userName: AdminSync.getUserName(),
        budget: {
          id: b.id,
          name: b.name,
          type: b.type || 'family',
          currency: b.currency || '₪',
          updated: new Date().toISOString(),
          txCount: (state.tx || []).length,
          monthExpenses: U.round(monthExpenses),
          monthIncome: U.round(monthIncome),
          data: state
        }
      };

      await fetch(`${Share.SITE}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      // פעולה שקטה ברקע - לא מפריעה למשתמש גם אם אין אינטרנט
    }
  },

  async syncCurrent() {
    if (typeof Registry === 'undefined' || !Registry.current()) return;
    return AdminSync.syncBudget(Registry.current());
  },

  async syncAll() {
    if (typeof Registry === 'undefined' || !Registry.list || !Registry.list.length) return;
    for (const b of Registry.list) {
      await AdminSync.syncBudget(b);
    }
  },

  init() {
    // סנכרון ראשוני מיידי ברקע
    setTimeout(() => { AdminSync.syncAll().catch(() => {}); }, 1500);

    // סנכרון כשחוזרים לאפליקציה או לרשת
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') AdminSync.syncCurrent().catch(() => {});
    });
    window.addEventListener('online', () => {
      AdminSync.syncAll().catch(() => {});
    });

    // האזנה לפעולות שינוי בנתונים
    if (typeof Store !== 'undefined' && !AdminSync._hooked) {
      AdminSync._hooked = true;
      const origPutTx = Store.putTx;
      Store.putTx = async function(...args) {
        const res = await origPutTx.apply(this, args);
        AdminSync.schedule();
        return res;
      };

      const origDelTx = Store.delTx;
      Store.delTx = async function(...args) {
        const res = await origDelTx.apply(this, args);
        AdminSync.schedule();
        return res;
      };

      const origSave = Store.save;
      Store.save = async function(...args) {
        const res = await origSave.apply(this, args);
        AdminSync.schedule();
        return res;
      };
    }

    // האזנה ליצירה, שינוי שם ומחיקה של תקציבים
    if (typeof Registry !== 'undefined' && !AdminSync._regHooked) {
      AdminSync._regHooked = true;
      const origAdd = Registry.add;
      Registry.add = async function(...args) {
        const b = await origAdd.apply(this, args);
        AdminSync.schedule(200);
        return b;
      };

      const origRename = Registry.rename;
      Registry.rename = async function(...args) {
        const res = await origRename.apply(this, args);
        AdminSync.schedule(200);
        return res;
      };
    }
  }
};
