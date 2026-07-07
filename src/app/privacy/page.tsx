import Link from 'next/link'

export const metadata = { title: 'Privacy Policy — Verdolo' }

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <Link href="/" className="text-sm text-sage hover:text-ink underline">
        ← Back
      </Link>
      <div className="mt-4 rounded-3xl bg-white shadow-md p-6 md:p-10 text-base leading-relaxed text-ink">
      <h1 className="mb-1 text-2xl font-semibold text-ink">Privacy Policy</h1>
      <p className="mb-8 text-sm text-sage">Last updated: [DATE — fill in when published]</p>

      <p className="mb-6">
        This Privacy Policy explains what information Verdolo (&quot;we&quot;, &quot;us&quot;) collects, how we use it, and
        the choices you have. It applies to the Verdolo web application and covers both your account information
        and the Customer Data your organization stores in the Service.
      </p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-ink">1. Information we collect</h2>
      <ul className="mb-6 list-disc pl-5 space-y-1">
        <li><strong>Account information:</strong> email address, password (hashed), display name, profile picture.</li>
        <li><strong>Customer Data you enter:</strong> client records, notes, tasks, calendar entries, and time entries you or your team create.</li>
        <li><strong>Billing information:</strong> handled directly by Stripe — we store your subscription status and plan, not your card details.</li>
        <li><strong>Usage data:</strong> basic log/analytics data (e.g. request timestamps) used for security and reliability.</li>
      </ul>

      <h2 className="mb-2 mt-8 text-base font-semibold text-ink">2. How we use it</h2>
      <p className="mb-6">
        We use this information to operate the Service: authenticate you, sync and display your organization&apos;s
        data, generate AI client messages (via Anthropic — your prompts and client context are sent to Anthropic to
        generate that message, subject to a monthly usage limit included with your plan), process subscription
        billing through Stripe, and provide customer support.
      </p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-ink">3. Who we share it with</h2>
      <p className="mb-6">
        We don&apos;t sell your data. We share it only with the service providers that power Verdolo, each acting on
        our instructions to provide the Service: Supabase (database, authentication, file storage), Vercel (hosting),
        Anthropic (AI message generation), and Stripe (subscription billing). Other members of your organization can
        see Customer Data according to their role&apos;s permissions, as described in-app.
      </p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-ink">4. Data retention and deletion</h2>
      <p className="mb-6">
        We retain your data for as long as your account is active. You can export your organization&apos;s data at any
        time from Settings. If you cancel your subscription or close your account, we retain data for a reasonable
        period to allow recovery/export, then delete it.
      </p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-ink">5. Security</h2>
      <p className="mb-6">
        Data is stored with row-level security so one organization cannot access another&apos;s data. Sensitive secrets
        are never exposed to the browser and are only readable by trusted server-side code. No method of
        transmission or storage is 100% secure, and we can&apos;t guarantee absolute security.
      </p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-ink">6. Your rights</h2>
      <p className="mb-6">
        Depending on where you live, you may have rights to access, correct, export, or delete your personal
        information. You can do most of this yourself in Settings, or contact us and we&apos;ll help.
      </p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-ink">7. Cookies</h2>
      <p className="mb-6">
        We use essential cookies to keep you signed in and maintain your session. We don&apos;t use third-party
        advertising cookies.
      </p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-ink">8. Children</h2>
      <p className="mb-6">Verdolo is a business tool and is not directed at, or intended for use by, children.</p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-ink">9. Changes to this policy</h2>
      <p className="mb-6">
        We may update this Policy from time to time. We&apos;ll notify the organization owner of material changes.
      </p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-ink">10. Contact</h2>
      <p className="mb-6">
        Questions about this Policy or your data? Contact us at{' '}
        <a href="mailto:kasey@kaseyfarren.com" className="text-accent underline">
          kasey@kaseyfarren.com
        </a>
        .
      </p>

      <p className="mt-10 text-sm text-sage">
        See also our <Link href="/terms" className="text-accent underline">Terms of Service</Link>.
      </p>
      </div>
    </main>
  )
}
