// One-time guided tour for a brand-new agency owner. Anchored to the sidebar nav items (which
// render on every authenticated page via AppShell) rather than page-specific elements, so the
// tour works no matter which page the owner lands on first and never needs to navigate between
// routes mid-tour.
export type TourStep = {
  selector: string
  title: string
  description: string
}

export const TOUR_STEPS: TourStep[] = [
  {
    selector: '[data-tour="nav-dashboard"]',
    title: 'Welcome to Verdolo',
    description: "Here's a quick tour of where everything lives - it only takes a minute, and you can skip at any point.",
  },
  {
    selector: '[data-tour="nav-clients"]',
    title: 'Add your first client',
    description: 'Start here. Each client needs a billing setup (retainer or hourly rate) - that\'s what powers your reports and invoices later.',
  },
  {
    selector: '[data-tour="nav-time"]',
    title: 'Track time',
    description: 'Log hours against a client here as work happens - this feeds directly into effective-rate and profitability reporting.',
  },
  {
    selector: '[data-tour="nav-proposals"]',
    title: 'Proposals & invoicing',
    description: 'Send proposals and generate invoices for your clients from here once they\'re set up.',
  },
  {
    selector: '[data-tour="nav-settings"]',
    title: 'Finish setup in Settings',
    description: 'Set your billing currency, invite teammates, and manage your subscription here.',
  },
]
