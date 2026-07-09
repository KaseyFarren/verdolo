// One-time guided tour for a brand-new agency owner. Unlike a single-page tooltip tour, this
// one walks the owner across the actual pages they'll use (Clients, Time, Proposals, Settings,
// Team) and calls out exactly which field to fill in and why - TourProvider drives the owner
// to each step's `path` via router.push between steps, since driver.js itself has no concept
// of navigation.
export type TourStep = {
  path: string
  selector: string
  title: string
  description: string
}

export const TOUR_STEPS: TourStep[] = [
  {
    path: '/dashboard',
    selector: '[data-tour="nav-dashboard"]',
    title: 'Welcome to Verdolo',
    description:
      "This is a quick guided tour - it'll walk you through each page and show you exactly where to enter your info. Takes about two minutes, and you can skip anytime with the X.",
  },
  {
    path: '/clients',
    selector: '[data-tour="add-client-button"]',
    title: 'Add your first client',
    description:
      'Click "+ New client" here to create one. Give it a name, then choose Retainer or Hourly and enter the rate - that number is what drives your reports, revenue, and invoices later, so it\'s worth getting right.',
  },
  {
    path: '/time',
    selector: '[data-tour="start-timer"]',
    title: 'Track your time',
    description:
      'Pick a client (and optionally a task) here and hit Start, or use "Log time manually" below to backfill hours you already worked. This is what feeds effective-rate and profitability reporting.',
  },
  {
    path: '/proposals',
    selector: '[data-tour="new-proposal-button"]',
    title: 'Send proposals & invoices',
    description:
      'Click "+ New proposal" to draft one for a client. Once they sign it, you can generate an invoice straight from the same proposal - no re-entering line items.',
  },
  {
    path: '/settings',
    selector: '[data-tour="billing-currency"]',
    title: 'Set your billing currency',
    description:
      'Pick the currency your clients actually pay you in here - USD, GBP, or EUR. It updates the symbol everywhere: Reports, Revenue, Clients, and invoices.',
  },
  {
    path: '/team',
    selector: '[data-tour="invite-teammate"]',
    title: 'Invite your team',
    description:
      "Enter a teammate's email and pick their role here to bring them into the org. That's everything - you're ready to run your agency in Verdolo.",
  },
]
