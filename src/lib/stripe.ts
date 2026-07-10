import 'server-only'
import Stripe from 'stripe'

// Server-only: the secret key must never reach the browser bundle.
export function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!)
}

export const SEAT_PRICE_ID = process.env.STRIPE_SEAT_PRICE_ID!

// Flat, non-tiered price for seats bought beyond the 2 a lifetime purchase already includes -
// the lifetime one-time fee already covers those 2, so this price never re-bills them.
export const LIFETIME_EXTRA_SEAT_PRICE_ID = process.env.STRIPE_LIFETIME_EXTRA_SEAT_PRICE_ID!
