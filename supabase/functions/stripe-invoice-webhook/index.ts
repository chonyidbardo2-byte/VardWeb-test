import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';

/*
 * Supabase Edge Function: stripe-invoice-webhook
 *
 * Keeps invoices.status in step with Stripe for invoices paid through
 * create-checkout (card or Canadian pre-authorized debit).
 *
 * Server-to-server: no CORS, no Supabase-issued JWT. Auth is Stripe's own
 * signature (STRIPE_INVOICE_WEBHOOK_SECRET, separate from the domain
 * webhook's secret), so this MUST be deployed with --no-verify-jwt.
 *
 * Only sessions carrying metadata.invoice_id are handled; anything else
 * (domain orders, other events) gets a 200 so Stripe stops retrying.
 *
 *   checkout.session.completed
 *     payment_status 'paid'  -> 'paid' (cards settle immediately)
 *     anything else          -> 'processing' (a bank debit is in flight,
 *                               up to 5 business days)
 *   checkout.session.async_payment_succeeded -> 'paid'
 *   checkout.session.async_payment_failed    -> 'failed'
 *
 * Deploy:
 *   npx.cmd supabase functions deploy stripe-invoice-webhook --no-verify-jwt --project-ref lvxlshberdazzmjbrjdu
 *   npx.cmd supabase secrets set STRIPE_INVOICE_WEBHOOK_SECRET=whsec_... --project-ref lvxlshberdazzmjbrjdu
 *     (Stripe Dashboard -> Developers -> Webhooks -> Add endpoint, pointed at
 *     this function's URL, listening for the three events above)
 */

const HANDLED = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
]);

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const rawBody = await req.text();
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { apiVersion: '2023-10-16' });

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      req.headers.get('stripe-signature') ?? '',
      Deno.env.get('STRIPE_INVOICE_WEBHOOK_SECRET') ?? ''
    );
  } catch (err) {
    console.error('stripe-invoice-webhook signature verification failed:', err.message);
    return new Response('Invalid signature', { status: 401 });
  }

  if (!HANDLED.has(event.type)) return new Response('ok', { status: 200 });

  const session = event.data.object as {
    metadata?: { invoice_id?: string };
    payment_status?: string;
    payment_intent?: string | null;
  };
  const invoiceId = session.metadata?.invoice_id;
  if (!invoiceId) return new Response('ok', { status: 200 });

  const today = new Date().toISOString().slice(0, 10);
  let update: Record<string, unknown>;
  if (event.type === 'checkout.session.async_payment_failed') {
    update = { status: 'failed' };
  } else if (event.type === 'checkout.session.async_payment_succeeded' || session.payment_status === 'paid') {
    update = { status: 'paid', paid_date: today };
  } else {
    update = { status: 'processing' };
  }
  if (session.payment_intent) update.stripe_payment_intent = session.payment_intent;

  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

  // Never move a paid invoice backwards (events can arrive out of order)
  let query = sb.from('invoices').update(update).eq('id', invoiceId);
  if (update.status !== 'paid') query = query.neq('status', 'paid');
  const { error } = await query;

  if (error) {
    console.error(`stripe-invoice-webhook: update failed for invoice ${invoiceId}:`, error.message);
    // 500 so Stripe retries later
    return new Response('Update failed', { status: 500 });
  }

  return new Response('ok', { status: 200 });
});
