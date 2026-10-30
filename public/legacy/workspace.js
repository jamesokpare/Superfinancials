/* =====================================================================
   Superfinancials — workspaces saved to the database
   Next.js port add-on, loaded right after superfinancials.js
   (src/components/LegacyApp.tsx).
   A signed-in account's workspace (watchlists, notes, alerts, graphs,
   dashboards, portfolio, screens, models, clients, decks, preferences) is
   kept in its own document, data/users/<uid>/workspace, which row-level
   security lets only that user read or write. The browser copy
   (localStorage sf.ws.<email>) stays as a cache, so the app opens at once
   and works offline.
     on sign-in   the newer of the browser copy and the saved copy wins
                  (by savedAt); a browser workspace with no saved copy yet
                  is uploaded, so nothing is lost when moving over
     on save      changes are written to the database a moment later
                  (one write per burst of edits, and at once when the tab
                  is hidden or closed)
     live         a save from another device or tab replaces this one when
                  there are no unsaved edits here
   An encrypted workspace (workspace lock) is stored encrypted: the
   database only ever holds the ciphertext. Local profiles, which have no
   account, stay in this browser only.
   ===================================================================== */
'use strict';
const WSC = { st: 'off', uid: null, dev: Math.random().toString(36).slice(2, 10), timer: null, pending: null, saving: null, lastAt: 0, err: null, unsub: null, warned: false };
const wscRef = () => CLOUD.db.doc('data/users/' + WSC.uid + '/workspace');
const wscEmail = () => 'cloud.' + WSC.uid;
const wscAt = v => (v && +v.savedAt) || 0;

/** Called by cloudBoot() before the workspace is opened. */
async function wsCloudPull() {
  if (!CLOUD.on || !CLOUD.db || !CLOUD.uid) return;
  WSC.uid = CLOUD.uid; const key = 'sf.ws.' + wscEmail();
  const local = LS.get(key);
  let snap = null;
  try { snap = await withTimeout(wscRef().get(), 8000); } catch (e) { WSC.err = e; }
  if (!snap) { WSC.st = 'offline'; wscRetry(); return; } // keep working from the browser copy; pull again shortly
  const remote = snap.exists ? snap.data() : null;
  if (remote && remote.ws && (!local || wscAt(remote) >= wscAt(local))) LS.set(key, remote.ws);
  else if (local && (!remote || wscAt(local) > wscAt(remote))) await wscWrite(local).catch(e => { WSC.err = e; }); // first sign-in after the move, or offline edits
  WSC.lastAt = Math.max(wscAt(remote), wscAt(local)); WSC.st = WSC.err ? 'error' : 'on';
  wscListen();
}
function wscRetry() { setTimeout(async () => { if (WSC.st !== 'offline' || !CLOUD.on) return; try { const s = await withTimeout(wscRef().get(), 8000); if (!s) return wscRetry(); WSC.st = 'on'; const r = s.exists ? s.data() : null; if (WSC.pending) wscFlush(); else if (r && wscAt(r) > WSC.lastAt) wscApply(r); wscListen(); } catch (e) { wscRetry(); } }, 30000); }

/** Called by wsPut() on every workspace save (plain or encrypted). */
function wsCloudPush(email, val) {
  if (!WSC.uid || email !== wscEmail()) return; // local profiles stay in the browser
  WSC.pending = val; clearTimeout(WSC.timer); WSC.timer = setTimeout(wscFlush, 1500);
}
async function wscFlush() {
  clearTimeout(WSC.timer); WSC.timer = null; const val = WSC.pending; if (!val || WSC.st === 'offline') return;
  WSC.pending = null;
  WSC.saving = (WSC.saving || Promise.resolve()).then(() => wscWrite(val)).then(() => { WSC.err = null; WSC.st = 'on'; WSC.warned = false; }, e => {
    WSC.err = e; WSC.st = 'error'; if (!WSC.pending) WSC.pending = val; // retried with the next save, or in a minute
    if (!WSC.warned) { WSC.warned = true; toast('Your workspace could not be saved to your account. It is kept in this browser and will be saved again shortly.', true); }
    setTimeout(() => { if (WSC.pending) wscFlush(); }, 60000);
  });
  return WSC.saving;
}
function wscWrite(val) { const at = wscAt(val) || Date.now(); WSC.lastAt = Math.max(WSC.lastAt, at); return wscRef().set({ type: 'workspace', v: 1, savedAt: at, dev: WSC.dev, ws: val }); }

/* ---------- live updates from other devices ---------- */
function wscListen() {
  if (WSC.unsub || !CLOUD.db) return;
  try { WSC.unsub = wscRef().onSnapshot(s => { const r = s && s.exists ? s.data() : null; if (r && r.dev !== WSC.dev && wscAt(r) > WSC.lastAt) wscApply(r); }, () => { }); } catch (e) { }
}
async function wscApply(r) {
  if (WSC.pending || WSC.timer || !r.ws) return; // unsaved edits here win; the next save overwrites
  WSC.lastAt = wscAt(r); LS.set('sf.ws.' + wscEmail(), r.ws);
  if (!USER || USER.email !== wscEmail()) return;
  let next = r.ws;
  if (next.enc) { if (!(typeof wslActive === 'function' && wslActive())) return; try { next = await wslOpen(next, WSL.key, USER.email); } catch (e) { return; } } // locked elsewhere with another passphrase: keep this copy
  if (!next || next.v !== 1) return;
  const d = defaults(USER); S = { ...d, ...next, prefs: { ...d.prefs, ...(next.prefs || {}) } }; save.sig = wsSig();
  if (typeof WSL !== 'undefined' && WSL.key && WSL.email === USER.email) WSL.mem = S;
  try { applyTheme(); applyLayout(); render(); } catch (e) { console.error(e); }
  toast('Workspace updated from another device');
}

/* Save at once when the tab is hidden or closed (the delayed write might not run). */
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { try { if (S) save.flush(); } catch (e) { } if (WSC.pending) wscFlush(); } });
window.addEventListener('pagehide', () => { try { if (S) save.flush(); } catch (e) { } if (WSC.pending) wscFlush(); });

/** Settings › Storage & portability, for signed-in accounts. */
function wsCloudStatus() {
  const when = WSC.lastAt ? fdt(WSC.lastAt) : '—';
  if (WSC.st === 'error') return `<span class="badge bad">Not saved to your account</span> The last save failed (${esc((WSC.err && (WSC.err.message || WSC.err.code)) || 'connection problem')}). Your changes are kept in this browser and saved again automatically.`;
  if (WSC.st === 'offline') return '<span class="badge sim">Offline</span> Your account could not be reached, so changes are kept in this browser and saved to your account when it is back.';
  return `<span class="badge ok">Saved to your account</span> Your workspace follows you to any device you sign in on${typeof wslActive === 'function' && wslActive() ? ', encrypted with your passphrase' : ''}. Last saved ${esc(when)}.`;
}
