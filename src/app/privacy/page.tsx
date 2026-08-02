import Link from 'next/link'

export const metadata = { title: 'Privacy Policy - Verdolo' }

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <Link href="/" className="text-sm text-sage hover:text-ink underline">
        ← Back
      </Link>
      <div className="mt-4 rounded-3xl bg-white shadow-md p-6 md:p-10 text-base leading-relaxed text-ink">
      <h1 className="mb-1 text-2xl font-semibold text-ink">Privacy Policy</h1>
      <p className="mb-8 text-sm text-sage">Last updated: 16 July 2026</p>

      <p className="mb-6">
        This Privacy Policy explains what information Verdolo (&quot;we&quot;, &quot;us&quot;) collects, how we use it, and
        the choices you have. Verdolo is operated by Kasey Farren, trading as Verdolo, a sole trader based in the
        United Kingdom. This Policy applies to the Verdolo marketing website (verdolo.com) and the Verdolo web
        application (app.verdolo.com), and covers both your account information and the Customer Data your
        organization stores in the Service.
      </p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-ink">1. Information we collect</h2>
      <ul className="mb-6 list-disc pl-5 space-y-1">
        <li><strong>Account information:</strong> email address, password (hashed), display name, profile picture.</li>
        <li><strong>Customer Data you enter:</strong> client records, notes, tasks, calendar entries, and time entries you or your team create.</li>
        <li><strong>Billing information:</strong> handled directly by Stripe - we store your subscription status and plan, not your card details.</li>
        <li><strong>Usage data:</strong> basic log/analytics data (e.g. request timestamps, IP address, browser type) used for security and reliability.</li>
        <li><strong>Marketing website analytics and advertising data:</strong> if you visit verdolo.com, we may use tools such as Google Tag Manager and Meta Pixel to understand how visitors find and use the site and to measure the effectiveness of our advertising. These tools can collect information like pages viewed, referring website, and device/browser identifiers, and may set cookies or use similar technology. Where the law requires it, these tags are only loaded after you consent (e.g. via a cookie banner). See Section 7 (Cookies) below.</li>
      </ul>

      <h2 className="mb-2 mt-8 text-base font-semibold text-ink">2. How we use it</h2>
      <p className="mb-6">
        We use this information to operate the Service: authenticate you, sync and display your organization&apos;s
        data, generate AI client messages (via Anthropic - your prompts and client context are sent to Anthropic to
        generate that message, subject to a monthly usage limit included with your plan), process payments and
        subscription billing through Stripe, provide customer support, and (for the marketing website) measure and
        improve our advertising and understand how visitors use the site.
      </p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-ink">3. Who we share it with</h2>
      <p className="mb-6">
        We don&apos;t sell your data. We share it only with the service providers that power Verdolo, each acting on
        our instructions to provide the Service: Supabase (database, authentication, file storage), Vercel (hosting),
        Anthropic (AI message generation), Stripe (payments and subscription billing), and - where enabled on the
        marketing website - Google (Tag Manager) and Meta (Pixel) for site analytics and advertising measurement.
        Other members of your organization can see Customer Data according to their role&apos;s permissions, as
        described in-app. Some of these providers are based outside the UK/EEA (including in the United States);
        where that&apos;s the case, we rely on appropriate safeguards such as Standard Contractual Clauses to protect
        your data when it&apos;s transferred internationally.
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
        If you&apos;re in the UK or EEA, we act as data controller for your account information and data protection
        law (including the UK GDPR) gives you rights to access, correct, export, delete, or restrict use of your
        personal information, and to object to certain processing. You can do most of this yourself in Settings, or
        contact us and we&apos;ll help. If you&apos;re not satisfied with how we&apos;ve handled a request, you have the right
        to complain to the UK Information Commissioner&apos;s Office (ico.org.uk) or your local supervisory authority.
        If you live outside the UK/EEA, you may have similar rights under your local law.
      </p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-ink">7. Cookies</h2>
      <p className="mb-6">
        Within the Verdolo application, we use essential cookies to keep you signed in and maintain your session - we
        don&apos;t use advertising cookies there. On our marketing website (verdolo.com), we may additionally use
        non-essential cookies or similar technology set by Google Tag Manager and Meta Pixel for analytics and
        advertising, as described in Section 1. Where required by law, we only set these non-essential cookies with
        your consent, which you can manage via the cookie controls on the site.
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
        <a href="mailto:team@verdolo.com" className="text-accent underline">
          team@verdolo.com
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
