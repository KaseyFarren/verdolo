import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Supabase project origin - used for REST, realtime (wss) and avatar storage.
const SUPABASE_ORIGIN = "https://iijeotvebkdxujtdhwim.supabase.co";
const SUPABASE_WS = "wss://iijeotvebkdxujtdhwim.supabase.co";

// Next.js injects inline bootstrap scripts (and, in dev, uses eval for HMR).
// Tailwind, React and the sonner Toaster inject inline styles.
const scriptSrc = [
  "'self'",
  "'unsafe-inline'",
  ...(isDev ? ["'unsafe-eval'"] : []),
].join(" ");

const connectSrc = [
  "'self'",
  SUPABASE_ORIGIN,
  SUPABASE_WS,
  ...(isDev ? ["ws://localhost:*", "http://localhost:*"] : []),
].join(" ");

const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${SUPABASE_ORIGIN}`,
  "font-src 'self' data:",
  `connect-src ${connectSrc}`,
  // Stripe checkout is a top-level redirect, not an embed, but allow the frames
  // defensively in case an embedded checkout/element is added later.
  "frame-src https://js.stripe.com https://checkout.stripe.com",
  "form-action 'self' https://checkout.stripe.com",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
