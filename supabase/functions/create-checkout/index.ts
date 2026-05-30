import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

/*
 * Supabase Edge Function: create-checkout
 *
 * Accepts POST { invoice_id, amount, client_email }
 * Returns { checkout_url } or { error }
 *
 * Deploy:
 *   supabase functions deploy create-checkout
 *   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { invoice_id, amount, client_email } = await req.json();

    if (!invoice_id || !amount || amount <= 0) {
      return new Response(JSON.stringify({ error: 'invoice_id and a positive amount are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { apiVersion: '2023-10-16' });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'VardWeb Service Invoice', description: `Invoice #${invoice_id}` },
          unit_amount: Math.round(amount * 100), // cents
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: client_email || undefined,
      success_url: `${req.headers.get('origin') || 'https://vardweb.com'}/crm/portal.html?paid=1`,
      cancel_url:  `${req.headers.get('origin') || 'https://vardweb.com'}/crm/portal.html`,
      metadata: { invoice_id },
    });

    return new Response(JSON.stringify({ checkout_url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
