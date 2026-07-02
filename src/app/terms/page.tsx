import Link from 'next/link'

export const metadata = { title: 'Terms of Service — Agency Hub' }

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
      <Link href="/" className="text-xs underline">
        ← Back
      </Link>
      <h1 className="mt-4 mb-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">Terms of Service</h1>
      <p className="mb-8 text-xs text-gray-500">Last updated: [DATE — fill in when published]</p>

      <p className="mb-6">
        These Terms of Service (&quot;Terms&quot;) govern access to and use of Agency Hub (the &quot;Service&quot;),
        provided by [LEGAL ENTITY NAME] (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;). By creating an account or using the
        Service, you agree to these Terms on behalf of yourself and, if applicable, the organization you represent.
      </p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-gray-900 dark:text-gray-100">1. The Service</h2>
      <p className="mb-6">
        Agency Hub is a multi-user platform for running a client services agency: a client CRM, task and time
        tracking, calendar, and AI-assisted client messaging. Some features connect to third-party services on your
        behalf, including Google Gmail (to read and send email on your connected inbox), Anthropic (to generate AI
        messages using an API key you provide), and Stripe (to process subscription payments and, optionally, your
        own client billing).
      </p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-gray-900 dark:text-gray-100">2. Accounts and organizations</h2>
      <p className="mb-6">
        You must provide accurate information to create an account. Each account belongs to one organization at a
        time. Organizations have three roles — owner, admin, and member — with different levels of access described
        in-app. The organization owner is responsible for managing membership and is the billing contact for that
        organization&apos;s subscription.
      </p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-gray-900 dark:text-gray-100">3. Subscriptions and billing</h2>
      <p className="mb-6">
        The Service is billed per seat (active team member) on a monthly subscription, with a 14-day free trial for
        new organizations. After the trial, continued access requires an active paid subscription. Adding team
        members beyond your purchased seat count requires purchasing additional seats. Subscriptions are billed in
        advance and, except where required by law, fees are non-refundable. You may cancel at any time; access
        continues until the end of the current billing period. We may change pricing with advance notice to the
        organization owner.
      </p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-gray-900 dark:text-gray-100">4. Your data</h2>
      <p className="mb-6">
        You (and your organization) retain ownership of the client data, notes, tasks, and other content you input
        into the Service (&quot;Customer Data&quot;). We process Customer Data only to provide the Service. You&apos;re
        responsible for having the right to input any personal data you store about your own clients, and for
        complying with applicable law with respect to that data. You can export your data at any time from Settings.
      </p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-gray-900 dark:text-gray-100">5. Acceptable use</h2>
      <p className="mb-6">
        Don&apos;t use the Service to violate law, send unsolicited bulk email, store data you don&apos;t have rights to,
        attempt to breach or bypass its security, or resell access without our written agreement.
      </p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-gray-900 dark:text-gray-100">6. Third-party services</h2>
      <p className="mb-6">
        Features that connect to Google, Anthropic, or Stripe are subject to those providers&apos; own terms and
        policies. We are not responsible for their availability, accuracy, or acts or omissions. Our use of Gmail
        data via the Google API follows the{' '}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Google API Services User Data Policy
        </a>
        , including its Limited Use requirements.
      </p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-gray-900 dark:text-gray-100">7. Termination</h2>
      <p className="mb-6">
        You may stop using the Service and cancel your subscription at any time. We may suspend or terminate access
        for breach of these Terms, non-payment, or to comply with law. On termination, we&apos;ll retain Customer Data
        for a reasonable period to allow export, then delete it in the ordinary course.
      </p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-gray-900 dark:text-gray-100">8. Disclaimers and limitation of liability</h2>
      <p className="mb-6">
        The Service is provided &quot;as is&quot; without warranties of any kind. To the maximum extent permitted by law,
        we are not liable for indirect, incidental, or consequential damages, and our total liability for any claim
        will not exceed the amount you paid us in the twelve months before the claim arose.
      </p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-gray-900 dark:text-gray-100">9. Changes to these Terms</h2>
      <p className="mb-6">
        We may update these Terms from time to time. We&apos;ll notify the organization owner of material changes.
        Continued use after a change takes effect means you accept the updated Terms.
      </p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-gray-900 dark:text-gray-100">10. Governing law</h2>
      <p className="mb-6">These Terms are governed by the laws of [JURISDICTION — fill in], without regard to conflict-of-law principles.</p>

      <h2 className="mb-2 mt-8 text-base font-semibold text-gray-900 dark:text-gray-100">11. Contact</h2>
      <p className="mb-6">
        Questions about these Terms? Contact us at{' '}
        <a href="mailto:kasey@kaseyfarren.com" className="underline">
          kasey@kaseyfarren.com
        </a>
        .
      </p>

      <p className="mt-10 text-xs text-gray-500">
        See also our <Link href="/privacy" className="underline">Privacy Policy</Link>.
      </p>
    </main>
  )
}
