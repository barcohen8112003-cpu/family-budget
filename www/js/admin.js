'use strict';
/* לוח בקרה וניהול לכל התקציבים של כל המשתמשים */

const Admin = {
  token: localStorage.getItem('fb_admin_token') || 'family-admin-2026',
  viewingBudget: null,
  cachedOverview: null,
  autoRefreshTimer: null,
  filterText: '',
  filterType: 'all',

  isActive() {
    if (typeof Platform !== 'undefined' && Platform.android && window.AndroidBridge && window.AndroidBridge.isAdmin) {
      try {
        if (window.AndroidBridge.isAdmin()) return true;
      } catch (e) {}
    }
    if (localStorage.getItem('fb_is_admin') === 'true') return true;
    if (new URLSearchParams(window.location.search).get('admin') === '1') return true;
    return false;
  },

  setAdminMode(active) {
    if (active) localStorage.setItem('fb_is_admin', 'true');
    else localStorage.removeItem('fb_is_admin');
  },

  async fetchOverview() {
    try {
      const res = await fetch(`${Share.SITE}/api/admin/overview`, {
        headers: {
          'Authorization': `Bearer ${Admin.token}`
        }
      });
      if (res.status === 401) {
        throw new Error('סיסמת האדמין שגויה.');
      }
      if (!res.ok) throw new Error(`שגיאת שרת (${res.status})`);
      const data = await res.json();
      Admin.cachedOverview = data;
      return data;
    } catch (e) {
      console.error('Failed to fetch admin overview:', e);
      throw e;
    }
  },

  async fetchBudget(budgetId) {
    const res = await fetch(`${Share.SITE}/api/admin/budget/${budgetId}`, {
      headers: {
        'Authorization': `Bearer ${Admin.token}`
      }
    });
    if (!res.ok) throw new Error('לא ניתן לטעון את נתוני התקציב.');
    return (await res.json()).budget;
  },

  async deleteBudget(budgetId, budgetName) {
    if (!(await UI.confirm(`האם למחוק את התקציב "${budgetName}" מהענן לצמיתות?`, 'מחיקה מהענן', true))) return;
    try {
      const res = await fetch(`${Share.SITE}/api/admin/budget/${budgetId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${Admin.token}`
        }
      });
      if (!res.ok) throw new Error('מחיקת התקציב נכשלה.');
      UI.toast(`התקציב "${budgetName}" נמחק מהענן`);
      App.render();
    } catch (e) {
      UI.error(e);
    }
  },

  async openUserBudget(budgetId, userName, budgetName) {
    try {
      UI.toast('טוען את התקציב של ' + userName + '...');
      const full = await Admin.fetchBudget(budgetId);
      if (!full || !full.data) throw new Error('נתוני התקציב אינם זמינים.');

      // מאגר ייעודי לצפייה בתקציב המשתמש
      const dbName = `family-budget-admin-view-${budgetId}`;
      const type = full.type || 'family';
      const currency = full.currency || '₪';

      await new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('tx')) db.createObjectStore('tx', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
        };
        req.onsuccess = async () => {
          const db = req.result;
          const t = db.transaction(['tx', 'kv'], 'readwrite');
          const txStore = t.objectStore('tx');
          const kvStore = t.objectStore('kv');
          
          txStore.clear();
          (full.data.tx || []).forEach(tx => txStore.put(tx));

          kvStore.clear();
          const kvData = {
            categories: full.data.categories || [],
            budgets: full.data.budgets || {},
            goals: full.data.goals || [],
            sources: full.data.sources || [],
            settings: full.data.settings || { members: [userName || 'משתמש'] },
            deleted: full.data.deleted || {},
            stamps: full.data.stamps || {}
          };
          Object.entries(kvData).forEach(([k, v]) => kvStore.put({ key: k, value: v }));

          t.oncomplete = () => { db.close(); resolve(); };
          t.onerror = () => { db.close(); reject(t.error); };
        };
        req.onerror = () => reject(req.error);
      });

      Admin.viewingBudget = {
        budgetId,
        userName,
        budgetName: full.name || budgetName,
        previousLast: Registry.last
      };

      App.readOnly = false;
      App.kind = type;
      App.home = type === 'trip' ? 'trip' : 'dashboard';
      U.cur = currency;

      await Store.load(dbName, type);
      Period.ym = Calc.latestMonth();
      App.go(App.home);
      UI.toast(`התקציב "${budgetName}" נפתח`);
    } catch (e) {
      UI.error(e);
    }
  },

  exitViewingBudget() {
    if (!Admin.viewingBudget) return;
    const prev = Admin.viewingBudget.previousLast;
    Admin.viewingBudget = null;
    if (prev && Registry.get(prev)) {
      App.openBudget(prev);
    } else {
      App.go('admin');
    }
  },

  quickView(budgetId) {
    if (!Admin.cachedOverview) return;
    const all = Admin.cachedOverview.allBudgets || [];
    const b = all.find(x => x.id === budgetId);
    if (!b) return;

    UI.modal({
      title: `סקירה: ${b.name}`,
      wide: true,
      body: `
        <div class="stack" style="gap:16px">
          <div class="row between" style="background:var(--bg-subtle, rgba(0,0,0,0.03));padding:12px;border-radius:8px">
            <div><strong>משתמש:</strong> ${U.esc(b.user_name || 'משתמש')}</div>
            <div><strong>סוג:</strong> ${b.type === 'trip' ? 'טיול' : 'משפחה'}</div>
            <div><strong>עודכן:</strong> ${new Date(b.updated).toLocaleString('he-IL')}</div>
          </div>
          <div class="grid c3" style="gap:12px">
            <div class="card" style="text-align:center;padding:12px">
              <div class="caption">הוצאות החודש</div>
              <div class="num over" style="font-size:1.3rem;font-weight:700">${U.nf.format(b.month_expenses || 0)} ${b.currency || '₪'}</div>
            </div>
            <div class="card" style="text-align:center;padding:12px">
              <div class="caption">הכנסות החודש</div>
              <div class="num ok" style="font-size:1.3rem;font-weight:700">${U.nf.format(b.month_income || 0)} ${b.currency || '₪'}</div>
            </div>
            <div class="card" style="text-align:center;padding:12px">
              <div class="caption">סה״כ עסקאות</div>
              <div class="num" style="font-size:1.3rem;font-weight:700">${b.tx_count || 0}</div>
            </div>
          </div>
          <p class="caption">${UI.icon('info')} לפתיחת כל העסקאות, הגרפים, הקטגוריות והיעדים המלאים, לחצו על "פתיחת התקציב המלא".</p>
        </div>
      `,
      actions: [
        {
          label: 'פתיחת התקציב המלא',
          cls: 'primary',
          onClick: (close) => {
            close();
            Admin.openUserBudget(b.id, b.user_name, b.name);
          }
        },
        {
          label: 'סגירה',
          cls: 'ghost',
          onClick: (close) => close()
        }
      ]
    });
  },

  async exportBudget(budgetId, budgetName) {
    try {
      UI.toast('מייצא את נתוני התקציב...');
      const full = await Admin.fetchBudget(budgetId);
      if (!full || !full.data) throw new Error('אין נתונים לייצוא.');
      const jsonStr = JSON.stringify(full, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const safeName = (budgetName || 'budget').replace(/[/\\?%*:|"<>]/g, '_');
      UI.download(blob, `budget_${safeName}_${U.today()}.json`);
      UI.toast('הקובץ הורד בהצלחה');
    } catch (e) {
      UI.error(e);
    }
  },

  banner() {
    if (!Admin.viewingBudget) return '';
    const v = Admin.viewingBudget;
    return `
      <div class="alert info no-print" style="margin-bottom:16px;background:#0f5c57;color:#fff;border-radius:10px;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 4px 12px rgba(0,0,0,0.15)">
        <div style="display:flex;align-items:center;gap:10px">
          ${UI.icon('shield')}
          <span><strong>מצב אדמין:</strong> צופה בתקציב <strong>"${U.esc(v.budgetName)}"</strong> של <strong>${U.esc(v.userName)}</strong></span>
        </div>
        <button class="btn sm" data-admin-exit style="background:#fff;color:#0f5c57;font-weight:bold;border:none">חזרה ללוח אדמין</button>
      </div>
    `;
  }
};

// מסך הניהול הראשי
Views.admin = async (main) => {
  // איפוס טיימר קיים
  if (Admin.autoRefreshTimer) {
    clearInterval(Admin.autoRefreshTimer);
    Admin.autoRefreshTimer = null;
  }

  main.innerHTML = `
    <div class="page-head" style="margin-bottom:20px">
      <div class="row between" style="align-items:center">
        <div>
          <h1 style="display:flex;align-items:center;gap:10px">${UI.icon('shield')} מרכז שליטה לאדמין</h1>
          <p class="muted" style="margin-top:4px">צפייה בכל התקציבים והעסקאות של כל המשתמשים בענן</p>
        </div>
        <div class="row" style="gap:8px">
          <label class="btn" title="העלאת קובץ גיבוי של משתמש ישירות לענן" style="cursor:pointer">
            ${UI.icon('upload')}ייבוא גיבוי לענן
            <input type="file" accept=".json,application/json" id="admin-import-backup" hidden>
          </label>
          <button class="btn" data-admin-sync-local title="סנכרן תקציבים מקומיים עכשיו">${UI.icon('cloud-upload')}סנכרון מקומי</button>
          <button class="btn primary" data-admin-refresh>${UI.icon('refresh-cw')}רענון</button>
        </div>
      </div>
    </div>
    <div id="admin-content"><div class="card empty">${UI.icon('refresh-cw')}<p>טוען נתונים מהענן...</p></div></div>
  `;

  const refreshBtn = $('[data-admin-refresh]', main);
  const syncLocalBtn = $('[data-admin-sync-local]', main);

  syncLocalBtn.onclick = async () => {
    syncLocalBtn.disabled = true;
    UI.toast('מסנכרן תקציבים מקומיים...');
    try {
      await AdminSync.syncAll();
      UI.toast('התקציבים המקומיים סונכרנו בהצלחה');
      await loadData();
    } catch (e) {
      UI.error(e);
    } finally {
      syncLocalBtn.disabled = false;
    }
  };

  const fileInput = $('#admin-import-backup', main);
  if (fileInput) {
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data || !Array.isArray(data.tx)) throw new Error('קובץ הגיבוי אינו תקין (חסרות עסקאות).');

        const userName = prompt('איזה שם משתמש לשייך לתקציב זה? (למשל: אבא, דני):', 'אבא') || 'משתמש';
        const budgetName = prompt('שם התקציב:', 'תקציב משפחתי') || 'תקציב משפחתי';

        UI.toast('מעלה את נתוני הגיבוי לענן...');
        const curYm = U.today().slice(0, 7);
        let monthExpenses = 0, monthIncome = 0;
        data.tx.forEach(t => {
          if (t.date && t.date.slice(0, 7) === curYm) {
            if ((typeof Cat !== 'undefined' && Cat.isIncome(t.categoryId)) || t.amount > 0) monthIncome += Math.abs(t.amount);
            else monthExpenses += Math.abs(t.amount);
          }
        });

        const payload = {
          userId: 'usr_' + U.uid(),
          userName: userName.trim(),
          budget: {
            id: 'b_' + U.uid(),
            name: budgetName.trim(),
            type: 'family',
            currency: '₪',
            updated: new Date().toISOString(),
            txCount: data.tx.length,
            monthExpenses: U.round(monthExpenses),
            monthIncome: U.round(monthIncome),
            data: data
          }
        };

        await fetch(`${Share.SITE}/api/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        UI.toast('הגיבוי הועלה בהצלחה לענן!');
        await loadData();
      } catch (err) {
        UI.error(err);
      } finally {
        fileInput.value = '';
      }
    };
  }

  refreshBtn.onclick = () => loadData();

  async function loadData(silent = false) {
    const container = $('#admin-content', main);
    if (!container) return;
    if (!silent) refreshBtn.disabled = true;

    try {
      const data = await Admin.fetchOverview();
      const summary = data.summary || { totalUsers: 0, totalBudgets: 0, totalTx: 0, totalMonthExpenses: 0, totalMonthIncome: 0 };
      const users = data.users || [];
      const allBudgets = data.allBudgets || [];

      // חישוב הוצאות לכל משתמש
      const userExpenses = users.map(u => {
        const exp = (u.budgets || []).reduce((acc, b) => acc + (Number(b.month_expenses) || 0), 0);
        return { name: u.userName || 'משתמש', expenses: exp, id: u.userId };
      }).sort((a, b) => b.expenses - a.expenses);

      // סינון לפי טקסט וסוג
      const q = Admin.filterText.toLowerCase().trim();
      const filteredUsers = users.map(u => {
        const matchingBudgets = (u.budgets || []).filter(b => {
          const matchType = Admin.filterType === 'all' || b.type === Admin.filterType;
          const matchText = !q || (b.name && b.name.toLowerCase().includes(q)) || (u.userName && u.userName.toLowerCase().includes(q));
          return matchType && matchText;
        });
        return { ...u, budgets: matchingBudgets };
      }).filter(u => u.budgets.length > 0 || (!q && Admin.filterType === 'all'));

      container.innerHTML = `
        <!-- כרטיסי סיכום ראשיים -->
        <div class="grid c4" style="gap:16px;margin-bottom:20px">
          <div class="card" style="padding:16px;background:linear-gradient(135deg, rgba(15,92,87,0.08), rgba(15,92,87,0.02));border-right:4px solid var(--brand, #0f5c57)">
            <div class="caption" style="display:flex;align-items:center;gap:6px">${UI.icon('users')} משתמשים במערכת</div>
            <div class="num" style="font-size:1.8rem;font-weight:700;margin-top:6px">${summary.totalUsers}</div>
          </div>
          <div class="card" style="padding:16px;background:linear-gradient(135deg, rgba(26,106,168,0.08), rgba(26,106,168,0.02));border-right:4px solid #1a6aa8">
            <div class="caption" style="display:flex;align-items:center;gap:6px">${UI.icon('wallet')} תקציבים בענן</div>
            <div class="num" style="font-size:1.8rem;font-weight:700;margin-top:6px">${summary.totalBudgets}</div>
          </div>
          <div class="card" style="padding:16px;background:linear-gradient(135deg, rgba(107,91,149,0.08), rgba(107,91,149,0.02));border-right:4px solid #6b5b95">
            <div class="caption" style="display:flex;align-items:center;gap:6px">${UI.icon('receipt')} סה״כ עסקאות</div>
            <div class="num" style="font-size:1.8rem;font-weight:700;margin-top:6px">${U.nf.format(summary.totalTx)}</div>
          </div>
          <div class="card" style="padding:16px;background:linear-gradient(135deg, rgba(179,64,31,0.08), rgba(179,64,31,0.02));border-right:4px solid #b3401f">
            <div class="caption" style="display:flex;align-items:center;gap:6px">${UI.icon('trending-down')} הוצאות החודש (כולל)</div>
            <div class="num over" style="font-size:1.8rem;font-weight:700;margin-top:6px">${U.nf.format(summary.totalMonthExpenses)} ₪</div>
          </div>
        </div>

        <!-- התפלגות הוצאות לפי משתמשים -->
        ${userExpenses.length > 0 && summary.totalMonthExpenses > 0 ? `
          <div class="card" style="margin-bottom:20px;padding:16px">
            <div class="row between" style="margin-bottom:12px">
              <strong style="display:flex;align-items:center;gap:8px">${UI.icon('pie-chart')} התפלגות הוצאות החודש לפי משתמש</strong>
              <span class="caption">סה״כ: ${U.nf.format(summary.totalMonthExpenses)} ₪</span>
            </div>
            <div class="stack" style="gap:10px">
              ${userExpenses.map(ux => {
                const pct = summary.totalMonthExpenses > 0 ? Math.round((ux.expenses / summary.totalMonthExpenses) * 100) : 0;
                return `
                  <div>
                    <div class="row between" style="font-size:0.95rem;margin-bottom:4px">
                      <span><strong>${U.esc(ux.name)}</strong></span>
                      <span>${U.nf.format(ux.expenses)} ₪ (${pct}%)</span>
                    </div>
                    <div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden">
                      <div style="height:100%;width:${pct}%;background:var(--brand, #0f5c57);border-radius:4px;transition:width 0.3s"></div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}

        <!-- סרגל חיפוש וסינון -->
        <div class="card row between" style="padding:12px 16px;margin-bottom:20px;gap:12px;flex-wrap:wrap">
          <div style="flex:1;min-width:220px;position:relative">
            <input id="admin-search" placeholder="חיפוש משתמש או תקציב..." value="${U.esc(Admin.filterText)}" style="width:100%;padding-right:32px">
            <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);opacity:0.5">${UI.icon('search')}</span>
          </div>
          <div class="seg" role="group" aria-label="סינון סוג תקציב">
            <button data-type-filter="all" aria-pressed="${Admin.filterType === 'all'}">הכול</button>
            <button data-type-filter="family" aria-pressed="${Admin.filterType === 'family'}">${UI.icon('house')} משפחה</button>
            <button data-type-filter="trip" aria-pressed="${Admin.filterType === 'trip'}">${UI.icon('plane')} טיול</button>
          </div>
        </div>

        <!-- רשימת המשתמשים והתקציבים שלהם -->
        ${filteredUsers.length ? `
          <div class="stack" style="gap:20px">
            ${filteredUsers.map(u => `
              <div class="card" style="padding:0;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.05)">
                <!-- כותרת משתמש -->
                <div style="background:var(--bg-subtle, rgba(0,0,0,0.02));padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
                  <div style="display:flex;align-items:center;gap:12px">
                    <span style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;background:var(--brand, #0f5c57);color:#fff;border-radius:50%;font-weight:bold;font-size:1.1rem">
                      ${U.esc((u.userName || 'מ').slice(0, 1))}
                    </span>
                    <div>
                      <div style="font-weight:700;font-size:1.1rem">${U.esc(u.userName || 'משתמש')}</div>
                      <div class="caption">מזהה: <span class="num">${U.esc(u.userId)}</span> · סנכרון אחרון: <span class="num">${new Date(u.lastActive || Date.now()).toLocaleString('he-IL')}</span></div>
                    </div>
                  </div>
                  <span class="chip" style="font-weight:600">${u.budgets.length} תקציבים</span>
                </div>

                <!-- רשימת התקציבים של המשתמש -->
                <div class="list" style="padding:8px 12px">
                  ${u.budgets.map(b => `
                    <div class="item" style="padding:12px;border-radius:8px;margin-bottom:6px;background:var(--bg-card);border:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
                      <div class="grow" style="min-width:200px">
                        <div style="display:flex;align-items:center;gap:8px">
                          <strong style="font-size:1.05rem">${U.esc(b.name)}</strong>
                          <span class="chip ${b.type === 'trip' ? 'brand' : ''}">${b.type === 'trip' ? 'טיול' : 'משפחה'}</span>
                          <span class="chip">${U.esc(b.currency || '₪')}</span>
                        </div>
                        <div class="row" style="margin-top:6px;gap:16px;font-size:0.9rem">
                          <span>הוצאות החודש: <strong class="num over">${U.nf.format(b.month_expenses || 0)} ${b.currency || '₪'}</strong></span>
                          <span>הכנסות החודש: <strong class="num ok">${U.nf.format(b.month_income || 0)} ${b.currency || '₪'}</strong></span>
                          <span>עסקאות: <strong class="num">${b.tx_count || 0}</strong></span>
                        </div>
                      </div>
                      <div class="row" style="gap:8px">
                        <button class="btn sm" data-admin-quick="${b.id}">${UI.icon('eye')}סקירה</button>
                        <button class="btn sm" data-admin-export="${b.id}" data-name="${U.esc(b.name)}">${UI.icon('download')}ייצוא</button>
                        <button class="btn sm primary" data-admin-open="${b.id}" data-user="${U.esc(u.userName)}" data-name="${U.esc(b.name)}">${UI.icon('folder-open')}פתיחת תקציב</button>
                        <button class="btn sm ghost icon" data-admin-del="${b.id}" data-name="${U.esc(b.name)}" title="מחיקה מהענן">${UI.icon('trash-2')}</button>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div class="card empty" style="padding:48px 24px;text-align:center">
            ${UI.icon('folder-search')}
            <h3 style="margin-top:12px">לא נמצאו תקציבים</h3>
            <p class="muted" style="margin-top:6px;max-width:500px;margin-inline:auto">
              ${q ? 'לא נמצאו משתמשים או תקציבים התואמים לחיפוש.' : 'כל תקציב שנוצר או מתעדכן באפליקציות של המשתמשים מסונכרן כעת אוטומטית לענן ויופיע כאן!'}
            </p>
          </div>
        `}
      `;

      // חיבור אירועים
      const searchInp = $('#admin-search', container);
      if (searchInp) {
        searchInp.oninput = (e) => {
          Admin.filterText = e.target.value;
          loadData(true);
        };
      }

      $$('[data-type-filter]', container).forEach(btn => {
        btn.onclick = () => {
          Admin.filterType = btn.dataset.typeFilter;
          loadData();
        };
      });

      $$('[data-admin-open]', container).forEach(btn => {
        btn.onclick = () => Admin.openUserBudget(btn.dataset.adminOpen, btn.dataset.user, btn.dataset.name);
      });

      $$('[data-admin-quick]', container).forEach(btn => {
        btn.onclick = () => Admin.quickView(btn.dataset.adminQuick);
      });

      $$('[data-admin-export]', container).forEach(btn => {
        btn.onclick = () => Admin.exportBudget(btn.dataset.adminExport, btn.dataset.name);
      });

      $$('[data-admin-del]', container).forEach(btn => {
        btn.onclick = () => Admin.deleteBudget(btn.dataset.adminDel, btn.dataset.name);
      });

      UI.icons();
    } catch (err) {
      container.innerHTML = `
        <div class="card empty" style="padding:36px;color:var(--danger)">
          ${UI.icon('alert-triangle')}
          <h3>שגיאה בטעינת נתוני האדמין מהענן</h3>
          <p class="muted" style="margin-top:6px">${U.esc(err.message || err)}</p>
          <button class="btn primary" style="margin-top:16px" data-retry>${UI.icon('refresh-cw')}ניסיון חוזר</button>
        </div>
      `;
      const retry = $('[data-retry]', container);
      if (retry) retry.onclick = () => loadData();
      UI.icons();
    } finally {
      refreshBtn.disabled = false;
    }
  }

  // רענון אוטומטי חי כל 12 שניות בעמוד האדמין
  Admin.autoRefreshTimer = setInterval(() => {
    if (App.route === 'admin' && !Admin.viewingBudget && document.visibilityState === 'visible') {
      loadData(true);
    }
  }, 12000);

  await loadData();
};
