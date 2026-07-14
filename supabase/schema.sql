-- ================================================================
-- VardWeb CRM — Complete Database Schema + RLS Policies
-- Paste the entire contents of this file into the Supabase
-- SQL Editor and click Run. Run it once on a fresh project.
-- ================================================================


-- ── 1. TABLES ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clients (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_name TEXT NOT NULL,
  contact_name  TEXT,
  contact_email TEXT NOT NULL UNIQUE,
  phone         TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS domain_groups (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id    UUID REFERENCES clients(id) ON DELETE CASCADE,
  group_name   TEXT NOT NULL DEFAULT 'Domain Group',
  content_mode TEXT NOT NULL DEFAULT 'shared',  -- shared | separate
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sites (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id       UUID REFERENCES clients(id) ON DELETE CASCADE,
  domain_group_id UUID REFERENCES domain_groups(id) ON DELETE SET NULL,
  domain_name     TEXT NOT NULL,
  cms_type        TEXT DEFAULT 'VardWeb CMS',
  status          TEXT DEFAULT 'active',   -- active | development | paused
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leases (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id            UUID REFERENCES clients(id) ON DELETE CASCADE,
  site_id              UUID REFERENCES sites(id) ON DELETE CASCADE,
  plan_name            TEXT,
  flat_rate            NUMERIC DEFAULT 0,
  recurring_rate       NUMERIC DEFAULT 0,
  billing_cycle        TEXT DEFAULT 'monthly',  -- monthly | yearly
  start_date           DATE,
  renewal_date         DATE,
  status               TEXT DEFAULT 'active',   -- active | cancelled | pending
  contract_accepted    BOOLEAN DEFAULT FALSE,
  contract_accepted_at TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id             UUID REFERENCES clients(id) ON DELETE CASCADE,
  lease_id              UUID REFERENCES leases(id) ON DELETE SET NULL,
  invoice_type          TEXT DEFAULT 'recurring',  -- flat_rate | recurring
  amount                NUMERIC NOT NULL,
  status                TEXT DEFAULT 'pending',    -- pending | paid | overdue
  due_date              DATE,
  paid_date             DATE,
  stripe_checkout_url   TEXT,
  stripe_payment_intent TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS domains (
  id                         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id                    UUID REFERENCES sites(id) ON DELETE CASCADE,
  client_id                  UUID REFERENCES clients(id) ON DELETE CASCADE,
  domain_name                TEXT NOT NULL,
  is_primary                 BOOLEAN DEFAULT FALSE,
  region_code                TEXT,  -- ISO 3166-1 alpha-2: CA, US, GB
  locale_code                TEXT,  -- BCP 47: en-CA, en-US, fr-CA
  currency_code              TEXT,  -- ISO 4217: CAD, USD, GBP
  region_label               TEXT,  -- Human-readable: Canada, United States
  registrar                  TEXT,
  dns_provider               TEXT,
  owned_by                   TEXT DEFAULT 'client',  -- client | vardweb
  transfer_status            TEXT,  -- NULL | pending_payment | transfer_initiated | transferred
  transfer_date              DATE,
  expiry_date                DATE,
  auto_renew                 BOOLEAN DEFAULT TRUE,
  purchase_cost              NUMERIC,
  registrar_login_url        TEXT,
  registrar_login_email      TEXT,
  registrar_login_password   TEXT,  -- AES-256-GCM ciphertext only
  credentials_submitted_by   TEXT,  -- client | admin
  credentials_submitted_at   TIMESTAMPTZ,
  notes                      TEXT,
  created_at                 TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hosting_access (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id                  UUID REFERENCES sites(id) ON DELETE CASCADE,
  client_id                UUID REFERENCES clients(id) ON DELETE CASCADE,
  provider_name            TEXT NOT NULL,
  provider_url             TEXT,
  access_type              TEXT,  -- shared_login | team_invite | api_key | ssh | cpanel
  login_email              TEXT,
  login_password           TEXT,  -- AES-256-GCM ciphertext only
  login_note               TEXT,
  credentials_submitted_by TEXT,  -- client | admin
  credentials_submitted_at TIMESTAMPTZ,
  visible_to_client        BOOLEAN DEFAULT TRUE,
  created_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site_content (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id       UUID REFERENCES sites(id) ON DELETE CASCADE,
  section_key   TEXT NOT NULL,
  content_value TEXT,
  content_type  TEXT DEFAULT 'text',  -- text | html | image_url | json
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(site_id, section_key)
);

CREATE TABLE IF NOT EXISTS seo_reports (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id    UUID REFERENCES clients(id) ON DELETE CASCADE,
  site_id      UUID REFERENCES sites(id) ON DELETE CASCADE,
  report_data  JSONB NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_links (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id        UUID REFERENCES sites(id) ON DELETE CASCADE,
  client_id      UUID REFERENCES clients(id) ON DELETE CASCADE,
  platform       TEXT NOT NULL,  -- instagram | facebook | x | tiktok | linkedin | youtube | custom
  account_handle TEXT,
  account_url    TEXT,
  display_label  TEXT,
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(site_id, platform)
);

CREATE TABLE IF NOT EXISTS site_analytics (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id            UUID REFERENCES sites(id) ON DELETE CASCADE,
  ga4_measurement_id TEXT,
  clarity_project_id TEXT,
  fb_pixel_id        TEXT,
  custom_head_script TEXT,
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(site_id)
);

-- blog_subscribers — VardWeb's own blog newsletter list. Global (no site_id):
-- VardWeb is not itself a row in clients/sites, so this is intentionally
-- outside the multi-tenant client/site scoping used everywhere else above.
CREATE TABLE IF NOT EXISTS blog_subscribers (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email              TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL DEFAULT 'active',   -- active | unsubscribed
  subscribed_at      TIMESTAMPTZ DEFAULT NOW(),
  unsubscribed_at    TIMESTAMPTZ,
  resend_contact_id  TEXT,                             -- Resend contact id; NULL = not yet synced / needs retry
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Must be last — references auth.users (Supabase built-in)
CREATE TABLE IF NOT EXISTS user_profiles (
  id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id),
  role      TEXT DEFAULT 'client',  -- admin | client
  full_name TEXT
);


-- ── 2. HELPER FUNCTIONS ─────────────────────────────────────────
-- SECURITY DEFINER bypasses RLS so these can safely query
-- user_profiles without causing infinite recursion.

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION my_client_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT client_id FROM user_profiles WHERE id = auth.uid();
$$;


-- ── 3. ENABLE ROW LEVEL SECURITY ────────────────────────────────

ALTER TABLE domain_groups  ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites          ENABLE ROW LEVEL SECURITY;
ALTER TABLE leases         ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices       ENABLE ROW LEVEL SECURITY;
ALTER TABLE domains        ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosting_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_content   ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_reports    ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_links   ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles  ENABLE ROW LEVEL SECURITY;


-- ── 4. RLS POLICIES ─────────────────────────────────────────────
-- Drop existing policies first so this script is fully re-runnable.

-- domain_groups — admin manages; clients read their own
DROP POLICY IF EXISTS "admin_all_domain_groups"  ON domain_groups;
DROP POLICY IF EXISTS "client_own_domain_groups" ON domain_groups;
CREATE POLICY "admin_all_domain_groups"  ON domain_groups FOR ALL    USING (is_admin());
CREATE POLICY "client_own_domain_groups" ON domain_groups FOR SELECT USING (client_id = my_client_id());

-- clients
DROP POLICY IF EXISTS "admin_all_clients"  ON clients;
DROP POLICY IF EXISTS "client_own_clients" ON clients;
CREATE POLICY "admin_all_clients"  ON clients FOR ALL            USING (is_admin());
CREATE POLICY "client_own_clients" ON clients FOR SELECT         USING (id = my_client_id());

-- sites
DROP POLICY IF EXISTS "admin_all_sites"  ON sites;
DROP POLICY IF EXISTS "client_own_sites" ON sites;
CREATE POLICY "admin_all_sites"    ON sites   FOR ALL            USING (is_admin());
CREATE POLICY "client_own_sites"   ON sites   FOR SELECT         USING (client_id = my_client_id());

-- leases
DROP POLICY IF EXISTS "admin_all_leases"  ON leases;
DROP POLICY IF EXISTS "client_own_leases" ON leases;
CREATE POLICY "admin_all_leases"   ON leases  FOR ALL            USING (is_admin());
CREATE POLICY "client_own_leases"  ON leases  FOR SELECT         USING (client_id = my_client_id());

-- invoices
DROP POLICY IF EXISTS "admin_all_invoices"  ON invoices;
DROP POLICY IF EXISTS "client_own_invoices" ON invoices;
CREATE POLICY "admin_all_invoices"  ON invoices FOR ALL          USING (is_admin());
CREATE POLICY "client_own_invoices" ON invoices FOR SELECT       USING (client_id = my_client_id());

-- domains — clients can SELECT + UPDATE their own credentials
DROP POLICY IF EXISTS "admin_all_domains"     ON domains;
DROP POLICY IF EXISTS "client_select_domains" ON domains;
DROP POLICY IF EXISTS "client_update_domains" ON domains;
CREATE POLICY "admin_all_domains"       ON domains FOR ALL       USING (is_admin());
CREATE POLICY "client_select_domains"   ON domains FOR SELECT    USING (client_id = my_client_id());
CREATE POLICY "client_update_domains"   ON domains FOR UPDATE    USING (client_id = my_client_id());

-- hosting_access — clients can SELECT, INSERT, and UPDATE their own entries
DROP POLICY IF EXISTS "admin_all_hosting"     ON hosting_access;
DROP POLICY IF EXISTS "client_select_hosting" ON hosting_access;
DROP POLICY IF EXISTS "client_insert_hosting" ON hosting_access;
DROP POLICY IF EXISTS "client_update_hosting" ON hosting_access;
CREATE POLICY "admin_all_hosting"     ON hosting_access FOR ALL    USING (is_admin());
CREATE POLICY "client_select_hosting" ON hosting_access FOR SELECT USING (client_id = my_client_id());
CREATE POLICY "client_insert_hosting" ON hosting_access FOR INSERT WITH CHECK (client_id = my_client_id());
CREATE POLICY "client_update_hosting" ON hosting_access FOR UPDATE USING (client_id = my_client_id());

-- site_content — clients can SELECT, INSERT, and UPDATE blocks for their own site
DROP POLICY IF EXISTS "admin_all_content"     ON site_content;
DROP POLICY IF EXISTS "client_select_content" ON site_content;
DROP POLICY IF EXISTS "client_insert_content" ON site_content;
DROP POLICY IF EXISTS "client_update_content" ON site_content;
CREATE POLICY "admin_all_content"     ON site_content FOR ALL    USING (is_admin());
CREATE POLICY "client_select_content" ON site_content FOR SELECT USING (
  site_id IN (SELECT id FROM sites WHERE client_id = my_client_id())
);
CREATE POLICY "client_insert_content" ON site_content FOR INSERT WITH CHECK (
  site_id IN (SELECT id FROM sites WHERE client_id = my_client_id())
);
CREATE POLICY "client_update_content" ON site_content FOR UPDATE USING (
  site_id IN (SELECT id FROM sites WHERE client_id = my_client_id())
);

-- seo_reports
DROP POLICY IF EXISTS "admin_all_seo"  ON seo_reports;
DROP POLICY IF EXISTS "client_own_seo" ON seo_reports;
CREATE POLICY "admin_all_seo"   ON seo_reports FOR ALL    USING (is_admin());
CREATE POLICY "client_own_seo"  ON seo_reports FOR SELECT USING (client_id = my_client_id());

-- social_links — clients can SELECT, INSERT, and UPDATE their own
DROP POLICY IF EXISTS "admin_all_social"     ON social_links;
DROP POLICY IF EXISTS "client_select_social" ON social_links;
DROP POLICY IF EXISTS "client_insert_social" ON social_links;
DROP POLICY IF EXISTS "client_update_social" ON social_links;
CREATE POLICY "admin_all_social"     ON social_links FOR ALL    USING (is_admin());
CREATE POLICY "client_select_social" ON social_links FOR SELECT USING (client_id = my_client_id());
CREATE POLICY "client_insert_social" ON social_links FOR INSERT WITH CHECK (client_id = my_client_id());
CREATE POLICY "client_update_social" ON social_links FOR UPDATE USING (client_id = my_client_id());

-- site_analytics — admin manages; clients read-only
DROP POLICY IF EXISTS "admin_all_analytics"     ON site_analytics;
DROP POLICY IF EXISTS "client_select_analytics" ON site_analytics;
CREATE POLICY "admin_all_analytics"     ON site_analytics FOR ALL    USING (is_admin());
CREATE POLICY "client_select_analytics" ON site_analytics FOR SELECT USING (
  site_id IN (SELECT id FROM sites WHERE client_id = my_client_id())
);

-- blog_subscribers — a public, unauthenticated visitor can INSERT their own
-- signup row (the blog.html form runs with no login). SELECT/UPDATE/DELETE
-- stay admin-only — nobody but admin can read the list or change status.
-- (Defense-in-depth: the real write path goes through a service-role Edge
-- Function, but this policy keeps the table usable if anything ever inserts
-- via the anon key directly.)
DROP POLICY IF EXISTS "admin_all_blog_subscribers"     ON blog_subscribers;
DROP POLICY IF EXISTS "public_insert_blog_subscribers" ON blog_subscribers;
CREATE POLICY "admin_all_blog_subscribers"     ON blog_subscribers FOR ALL    USING (is_admin());
CREATE POLICY "public_insert_blog_subscribers" ON blog_subscribers FOR INSERT WITH CHECK (true);

-- user_profiles — users read their own; admin reads all
DROP POLICY IF EXISTS "own_profile"        ON user_profiles;
DROP POLICY IF EXISTS "own_profile_insert" ON user_profiles;
DROP POLICY IF EXISTS "admin_all_profiles" ON user_profiles;
CREATE POLICY "own_profile"         ON user_profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "own_profile_insert"  ON user_profiles FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY "admin_all_profiles"  ON user_profiles FOR ALL    USING (is_admin());
