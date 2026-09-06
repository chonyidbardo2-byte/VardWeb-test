import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Webhook } from 'https://esm.sh/svix';

/*
 * Supabase Edge Function: resend-webhook
 *
 * Receives Resend webhook events. Server-to-server — no browser caller, no
 * CORS, no Supabase-issued JWT. Auth is the svix signature instead, so this
 * MUST be deployed with --no-verify-jwt or the platform gateway rejects
 * every call before this code ever runs.
 *
 * Currently handles contact.updated: syncs blog_subscribers.status/
 * unsubscribed_at to match Resend's own unsubscribed flag, both directions
 * (unsubscribe and a direct re-subscribe in Resend's dashboard). Other
 * event types are acknowledged as a no-op so Resend doesn't retry; add more
 * `if (event.type === ...)` branches here later if needed.
 *
 * The exact contact.updated payload shape (event.data.email /
 * event.data.unsubscribed) is inferred from the contact-object shape this
 * codebase already posts to POST /contacts in subscribe-newsletter, not
 * confirmed against a literal Resend doc example — the raw payload is
 * logged below so a real test event can confirm/correct the field names.
 *
 * Deploy:
 *   supabase functions deploy resend-webhook --no-verify-jwt
 *   supabase secrets set RESEND_WEBHOOK_SECRET=whsec_...   (from Resend
 *     Dashboard -> Webhooks -> Add Endpoint, after pointing it at this
 *     function's URL and selecting the contact.updated event)
 */

serve(async (req) => {
  const rawBody = await req.text();

  const wh = new Webhook(Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '');
  let event;
  try {
    event = wh.verify(rawBody, {
      'svix-id': req.headers.get('svix-id') ?? '',
      'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
      'svix-signature': req.headers.get('svix-signature') ?? '',
    });
  } catch (err) {
    console.error('resend-webhook signature verification failed:', err.message);
    return new Response('Invalid signature', { status: 401 });
  }

  console.log('resend-webhook received:', JSON.stringify(event));

  if (event.type === 'contact.updated') {
    const email = event.data?.email;
    const unsubscribed = event.data?.unsubscribed;

    if (email && typeof unsubscribed === 'boolean') {
      const sb = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      const { error } = await sb
        .from('blog_subscribers')
        .update(
          unsubscribed
            ? { status: 'unsubscribed', unsubscribed_at: new Date().toISOString() }
            : { status: 'active', unsubscribed_at: null }
        )
        .eq('email', String(email).trim().toLowerCase());

      if (error) console.error('resend-webhook blog_subscribers update failed:', error.message);
    } else {
      console.error('resend-webhook contact.updated payload missing expected fields:', JSON.stringify(event.data));
    }
  }

  return new Response('ok', { status: 200 });
});
