import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.SUPABASE_CONFIG || {};
export const supabase = createClient(cfg.url, cfg.anonKey);

/* Returns the current session user, or null */
export async function getUser() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}

/* Returns the user_profiles row for the current user, or null */
export async function getProfile() {
  const user = await getUser();
  if (!user) return null;
  const { data } = await supabase.from('user_profiles').select('*').eq('id', user.id).single();
  return data;
}

/*
 * requireAuth(role)
 * Call at top of every CRM page.
 * role: 'admin' | 'client' | null (any authenticated user)
 * Redirects to login if not authenticated or wrong role.
 * Returns the profile row on success.
 */
export async function requireAuth(role = null) {
  const profile = await getProfile();
  if (!profile) {
    window.location.href = '/crm/login.html';
    return null;
  }
  if (role && profile.role !== role) {
    window.location.href = profile.role === 'admin' ? '/crm/dashboard.html' : '/crm/portal.html';
    return null;
  }
  return profile;
}

/* Sign out and redirect to login */
export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = '/crm/login.html?signedout=1';
}
