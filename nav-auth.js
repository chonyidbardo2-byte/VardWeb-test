// nav-auth.js — shared module for all public pages
// Checks Supabase session; transforms #nav-login-btn into a profile dropdown if logged in.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.SUPABASE_CONFIG || {};
if (!cfg.url || !cfg.anonKey) { console.warn('nav-auth: SUPABASE_CONFIG not available'); }

// Logins are stored under role-keyed clients (crm/login.html, checkout.html),
// not Supabase's default storage slot — check both so a session created by
// either one shows up in the nav, whichever role it turns out to be.
const adminSb  = createClient(cfg.url || '', cfg.anonKey || '', { auth: { storageKey: 'vw-admin-auth'  } });
const clientSb = createClient(cfg.url || '', cfg.anonKey || '', { auth: { storageKey: 'vw-client-auth' } });

// Caches last-known display info so the profile button can render instantly
// on the next page load, before the real (async) Supabase check resolves —
// avoids a flash of the logged-out "Account" button on every navigation.
const CACHE_KEY = 'vw-nav-auth-cache';
let sb = null; // assigned once the real session check resolves; read via closure below

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (raw && typeof raw.name === 'string' && typeof raw.role === 'string' && typeof raw.email === 'string') return raw;
  } catch (_) {}
  return null;
}
function writeCache(data) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (_) {} }
function clearCache() { try { localStorage.removeItem(CACHE_KEY); } catch (_) {} }

function ensureProfileIconStyle() {
  if (document.getElementById('nav-profile-icon-style')) return;
  const style = document.createElement('style');
  style.id = 'nav-profile-icon-style';
  style.textContent = `
    @keyframes navIconHeadPop { 0% { opacity: 0; transform: scale(0.5); } 60% { transform: scale(1.2); } 100% { opacity: 1; transform: scale(1); } }
    @keyframes navIconCheckBodyDraw { 0% { stroke-dashoffset: 40; opacity: 0.3; } 100% { stroke-dashoffset: 0; opacity: 1; } }
    @keyframes navIconCheckTickDraw { 0% { stroke-dashoffset: 20; opacity: 0.3; } 100% { stroke-dashoffset: 0; opacity: 1; } }
    @media (hover: hover) and (pointer: fine) {
      #nav-profile-btn .ico-head { transform-origin: 10px 8px; }
      #nav-profile-btn:hover .ico-head, #nav-profile-btn:focus-visible .ico-head { animation: navIconHeadPop 0.36s ease-out; }
      #nav-profile-btn:hover .ico-body-check, #nav-profile-btn:focus-visible .ico-body-check { animation: navIconCheckBodyDraw 0.36s ease-in-out 0.12s backwards; }
      #nav-profile-btn:hover .ico-tick, #nav-profile-btn:focus-visible .ico-tick { animation: navIconCheckTickDraw 0.3s ease-in-out 0.3s backwards; }
    }
  `;
  document.head.appendChild(style);
}

function buildProfileWrapper({ name, role, email }, getSb) {
  ensureProfileIconStyle();
  const dashUrl  = role === 'admin' ? '/crm/dashboard.html' : '/crm/portal.html';
  const dashLabel = role === 'admin' ? 'Dashboard' : 'My Portal';
  const roleBadge = role === 'admin'
    ? 'background:rgba(0,229,255,0.12);color:#00E5FF;'
    : 'background:rgba(255,215,0,0.12);color:#FFD700;';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;display:inline-block;';
  wrapper.innerHTML = `
    <button id="nav-profile-btn" type="button" aria-label="Account menu" style="display:inline-flex;align-items:center;justify-content:center;background:none;border:none;padding:8px;cursor:pointer;color:#eef0f8;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path class="ico-body-check" d="M2 21a8 8 0 0 1 13.292-6"/><circle class="ico-head" cx="10" cy="8" r="5"/><path class="ico-tick" d="m16 19 2 2 4-4"/>
      </svg>
      <svg id="nav-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:none;"><polyline points="6 9 12 15 18 9"/></svg>
    </button>

    <div id="nav-profile-dropdown" hidden style="position:absolute;top:calc(100% + 8px);right:0;background:#0f1219;border:1px solid rgba(0,229,255,0.15);border-radius:12px;padding:8px;min-width:224px;box-shadow:0 16px 48px rgba(0,0,0,0.6),0 0 0 1px rgba(0,229,255,0.05);z-index:1000;">
      <div style="padding:10px 12px;border-bottom:1px solid rgba(0,229,255,0.08);margin-bottom:6px;">
        <div style="font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:#eef0f8;">${name}</div>
        <div style="font-size:11px;color:rgba(200,212,232,0.5);margin-top:2px;">${email}</div>
        <div style="margin-top:6px;display:inline-block;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;padding:2px 8px;border-radius:4px;${roleBadge}">${role.toUpperCase()}</div>
      </div>
      <a href="${dashUrl}" class="nav-dd-item" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;color:#eef0f8;text-decoration:none;font-size:13px;transition:background 0.15s ease;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        ${dashLabel}
        <span style="margin-left:auto;color:rgba(200,212,232,0.35);font-size:11px;">→</span>
      </a>
      <div style="border-top:1px solid rgba(0,229,255,0.08);margin:6px 0;"></div>
      <button id="nav-signout-btn" type="button" class="nav-dd-item" style="width:100%;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;background:rgba(255,45,120,0.08);border:none;color:#FF2D78;font-size:13px;cursor:pointer;font-family:'Inter',sans-serif;transition:background 0.15s ease;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Sign Out
      </button>
    </div>`;

  const btn      = wrapper.querySelector('#nav-profile-btn');
  const dropdown = wrapper.querySelector('#nav-profile-dropdown');
  const chevron  = wrapper.querySelector('#nav-chevron');

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = !dropdown.hidden;
    dropdown.hidden = open;
    chevron.style.transform = open ? '' : 'rotate(180deg)';
  });

  document.addEventListener('click', () => {
    dropdown.hidden = true;
    chevron.style.transform = '';
  });

  dropdown.addEventListener('click', e => e.stopPropagation());

  wrapper.querySelectorAll('.nav-dd-item').forEach(el => {
    el.addEventListener('mouseenter', () => { el.style.background = el.id === 'nav-signout-btn' ? 'rgba(255,45,120,0.16)' : 'rgba(0,229,255,0.08)'; });
    el.addEventListener('mouseleave', () => { el.style.background = el.id === 'nav-signout-btn' ? 'rgba(255,45,120,0.08)' : 'transparent'; });
  });

  wrapper.querySelector('#nav-signout-btn').addEventListener('click', async () => {
    const client = getSb();
    if (client) { await client.auth.signOut(); }
    else { await Promise.all([adminSb.auth.signOut(), clientSb.auth.signOut()]); }
    clearCache();
    window.location.reload();
  });

  return wrapper;
}

(async () => {
  const loginBtn = document.getElementById('nav-login-btn');
  if (!loginBtn) return;
  let renderedEl = loginBtn;

  // Instant render from cache, synchronously, before any network call.
  const cached = readCache();
  if (cached) {
    const w = buildProfileWrapper(cached, () => sb);
    renderedEl.replaceWith(w);
    renderedEl = w;
  }

  const { data: { session: adminSession } }  = await adminSb.auth.getSession();
  const { data: { session: clientSession } } = await clientSb.auth.getSession();
  const session = adminSession || clientSession;
  sb = adminSession ? adminSb : clientSb;

  if (!session) {
    clearCache();
    if (renderedEl !== loginBtn) { renderedEl.replaceWith(loginBtn); renderedEl = loginBtn; }
    return;
  }

  const user = session.user;
  const { data: profile } = await sb.from('user_profiles').select('full_name, role').eq('id', user.id).single();

  const real = {
    name: profile?.full_name || user.email.split('@')[0],
    role: profile?.role || 'client',
    email: user.email,
  };
  writeCache(real);

  const unchanged = cached && cached.name === real.name && cached.role === real.role && cached.email === real.email;
  if (!unchanged) {
    const w = buildProfileWrapper(real, () => sb);
    renderedEl.replaceWith(w);
    renderedEl = w;
  }
})();
