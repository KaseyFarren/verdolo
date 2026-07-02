import 'server-only'
import Stripe from 'stripe'

// Server-only: the secret key must never reach the browser bundle.
export function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!)
}

export const SEAT_PRICE_ID = process.env.STRIPE_SEAT_PRICE_ID!
