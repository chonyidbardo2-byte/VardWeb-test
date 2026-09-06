import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/*
 * Supabase Edge Function: subscribe-newsletter
 *
 * Public — no admin check (anyone can subscribe, same as create-checkout
 * being publicly callable). Accepts POST { email }.
 *
 * Persists to blog_subscribers first (source of truth), then best-effort
 * creates the matching Resend contact — a Resend failure does NOT fail the
 * whole request; resend_contact_id just stays null for later retry.
 *
 * Deploy:
 *   supabase functions deploy subscribe-newsletter
 *   supabase secrets set RESEND_API_KEY=re_...
 *   supabase secrets set RESEND_SEGMENT_ID=...
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { email } = await req.json();
    if (!email || !EMAIL_RE.test(email)) {
      return new Response(JSON.stringify({ error: 'A valid email is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const normalizedEmail = String(email).trim().toLowerCase();

    const sb = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: existing } = await sb
      .from('blog_subscribers')
      .select('status')
      .eq('email', normalizedEmail)
      .maybeSingle();
    const wasAlreadyActive = existing?.status === 'active';

    // Upsert so a repeat signup (or a previously-unsubscribed address)
    // is idempotent instead of erroring on the UNIQUE(email) constraint.
    const { data: row, error: dbError } = await sb
      .from('blog_subscribers')
      .upsert(
        { email: normalizedEmail, status: 'active', subscribed_at: new Date().toISOString(), unsubscribed_at: null },
        { onConflict: 'email' }
      )
      .select()
      .single();

    if (dbError) {
      return new Response(JSON.stringify({ error: dbError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Best-effort Resend sync — must NOT fail the whole request.
    let resendContactId = row.resend_contact_id || null;
    try {
      const resendRes = await fetch('https://api.resend.com/contacts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY') ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: normalizedEmail,
          unsubscribed: false,
          segments: [{ id: Deno.env.get('RESEND_SEGMENT_ID') ?? '' }],
        }),
      });
      const resendJson = await resendRes.json();
      if (resendRes.ok && resendJson.id) {
        resendContactId = resendJson.id;
        await sb.from('blog_subscribers').update({ resend_contact_id: resendContactId }).eq('id', row.id);
      } else {
        console.error('Resend contact create failed:', resendJson);
      }
    } catch (resendErr) {
      console.error('Resend contact create threw:', resendErr);
    }

    return new Response(JSON.stringify({ ok: true, already_subscribed: wasAlreadyActive, subscriber_id: row.id, resend_contact_id: resendContactId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
