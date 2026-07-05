import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe'
import type Stripe from 'stripe'

// Separate endpoint from /api/billing/webhook: this one is registered in Stripe as a
// "Connect" webhook (fires for events on any of the agencies' connected accounts), not the
// platform-account SaaS subscription events the other endpoint handles.
export async function POST(request: Request) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  const stripe = getStripe()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_CONNECT_WEBHOOK_SECRET!)
  } catch (err) {
    return NextResponse.json({ error: `Invalid signature: ${(err as Error).message}` }, { status: 400 })
  }

  const admin = createAdminClient()

  switch (event.type) {
    case 'account.updated': {
      const account = event.data.object as Stripe.Account
      const status = account.charges_enabled && account.details_submitted ? 'active' : 'pending'
      await admin.from('orgs').update({ stripe_connect_status: status }).eq('stripe_connect_account_id', account.id)
      break
    }
    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice
      await admin
        .from('invoices')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('stripe_invoice_id', invoice.id)
      break
    }
    case 'invoice.voided': {
      const invoice = event.data.object as Stripe.Invoice
      await admin.from('invoices').update({ status: 'void' }).eq('stripe_invoice_id', invoice.id)
      break
    }
    default:
      break
  }

  return NextResponse.json({ received: true })
}
