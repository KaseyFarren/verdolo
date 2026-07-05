import 'server-only'
import Stripe from 'stripe'

// Server-only: the secret key must never reach the browser bundle.
export function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!)
}

export const SEAT_PRICE_ID = process.env.STRIPE_SEAT_PRICE_ID!

// Stripe Connect (Standard accounts): every call that should act on the agency's own
// connected Stripe account, not Verdolo's platform account, takes this as its request options.
export function connectAccount(stripeAccountId: string) {
  return { stripeAccount: stripeAccountId }
}
