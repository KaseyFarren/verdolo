// Content-Security-Policy is built per-request in the proxy/middleware because the
// script-src nonce must be unique per response. The non-CSP security headers
// (X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) are static and
// stay in next.config.ts.

const SUPABASE_ORIGIN = 'https://iijeotvebkdxujtdhwim.supabase.co'
const SUPABASE_WS = 'wss://iijeotvebkdxujtdhwim.supabase.co'

// Edge-runtime safe: uses Web Crypto, no Buffer/Node APIs.
export function generateNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== 'production'

  // 'strict-dynamic' means Next's own nonced bootstrap scripts are trusted to load
  // the rest of the chunks; 'self'/host allow-lists are ignored by supporting
  // browsers once a nonce is present, which is what we want. 'unsafe-eval' is only
  // added in dev because Turbopack HMR needs it.
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(' ')

  // style-src intentionally keeps 'unsafe-inline' and does NOT carry a nonce:
  // motion/sonner/React set inline style="" attributes, and adding a nonce here
  // would make browsers ignore 'unsafe-inline' and break them.
  const connectSrc = [
    "'self'",
    SUPABASE_ORIGIN,
    SUPABASE_WS,
    'https://www.facebook.com',
    'https://connect.facebook.net',
    'https://www.google-analytics.com',
    'https://*.google-analytics.com',
    'https://*.analytics.google.com',
    ...(isDev ? ['ws://localhost:*', 'http://localhost:*'] : []),
  ].join(' ')

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${SUPABASE_ORIGIN} https://www.facebook.com`,
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    // Stripe checkout is a top-level redirect, not an embed, but allow the frames
    // defensively in case an embedded checkout/element is added later.
    'frame-src https://js.stripe.com https://checkout.stripe.com',
    "form-action 'self' https://checkout.stripe.com",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ')
}
