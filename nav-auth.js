// nav-auth.js — shared module for all public pages
// Checks Supabase session; transforms #nav-login-btn into a profile dropdown if logged in.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.SUPABASE_CONFIG || {};
if (!cfg.url || !cfg.anonKey) { console.warn('nav-auth: SUPABASE_CONFIG not available'); }

const sb = createClient(cfg.url || '', cfg.anonKey || '');

(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;

  const user = session.user;
  const { data: profile } = await sb.from('user_profiles').select('full_name, role').eq('id', user.id).single();

  const name    = profile?.full_name || user.email.split('@')[0];
  const role    = profile?.role || 'client';
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const dashUrl  = role === 'admin' ? '/crm/dashboard.html' : '/crm/portal.html';
  const dashLabel = role === 'admin' ? 'Dashboard' : 'My Portal';
  const roleBadge = role === 'admin'
    ? 'background:rgba(0,229,255,0.12);color:#00E5FF;'
    : 'background:rgba(255,215,0,0.12);color:#FFD700;';

  const loginBtn = document.getElementById('nav-login-btn');
  if (!loginBtn) return;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;display:inline-block;';
  wrapper.innerHTML = `
    <button id="nav-profile-btn" type="button" style="display:inline-flex;align-items:center;gap:10px;background:rgba(0,229,255,0.06);border:1px solid rgba(0,229,255,0.18);border-radius:10px;padding:7px 14px 7px 8px;cursor:pointer;font-family:'Inter',sans-serif;color:#eef0f8;transition:background 0.2s ease,border-color 0.2s ease;">
      <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#00E5FF 0%,#FF2D78 100%);display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:#070910;flex-shrink:0;">${initials}</div>
      <span style="font-size:13px;font-weight:500;letter-spacing:-0.01em;">${name}</span>
      <svg id="nav-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5;flex-shrink:0;transition:transform 0.2s ease;"><polyline points="6 9 12 15 18 9"/></svg>
    </button>

    <div id="nav-profile-dropdown" hidden style="position:absolute;top:calc(100% + 8px);right:0;background:#0f1219;border:1px solid rgba(0,229,255,0.15);border-radius:12px;padding:8px;min-width:224px;box-shadow:0 16px 48px rgba(0,0,0,0.6),0 0 0 1px rgba(0,229,255,0.05);z-index:1000;">
      <div style="padding:10px 12px;border-bottom:1px solid rgba(0,229,255,0.08);margin-bottom:6px;">
        <div style="font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:#eef0f8;">${name}</div>
        <div style="font-size:11px;color:rgba(200,212,232,0.5);margin-top:2px;">${user.email}</div>
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

  loginBtn.replaceWith(wrapper);

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

  btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(0,229,255,0.1)'; btn.style.borderColor = 'rgba(0,229,255,0.3)'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(0,229,255,0.06)'; btn.style.borderColor = 'rgba(0,229,255,0.18)'; });

  wrapper.querySelectorAll('.nav-dd-item').forEach(el => {
    el.addEventListener('mouseenter', () => { el.style.background = el.id === 'nav-signout-btn' ? 'rgba(255,45,120,0.16)' : 'rgba(0,229,255,0.08)'; });
    el.addEventListener('mouseleave', () => { el.style.background = el.id === 'nav-signout-btn' ? 'rgba(255,45,120,0.08)' : 'transparent'; });
  });

  wrapper.querySelector('#nav-signout-btn').addEventListener('click', async () => {
    await sb.auth.signOut();
    window.location.reload();
  });
})();
