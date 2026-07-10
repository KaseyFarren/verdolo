import { NextResponse } from 'next/server'

/**
 * Return a generic, user-safe error to the client while logging the real cause server-side.
 * Keeps raw Supabase/Stripe/internal error strings (which can leak schema or infra detail) out
 * of HTTP responses. Use for user-facing routes; admin/cron routes (owner-only) can keep raw
 * messages for debuggability.
 */
export function apiError(clientMessage: string, status: number, cause?: unknown) {
  if (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    console.error(`[api] ${clientMessage} (${status}):`, detail)
  }
  return NextResponse.json({ error: clientMessage }, { status })
}
