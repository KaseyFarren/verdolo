// Guided tour for a brand-new user. Unlike a single-page tooltip tour, this one walks the user
// across the actual pages they'll use and calls out exactly which field to fill in and why -
// TourProvider drives them to each step's `path` via a hard navigation between steps, since
// driver.js itself has no concept of navigation.
//
// Steps are role-aware: each carries the roles it applies to, and TourProvider filters the master
// list down to the current role before walking it. That gives three tailored paths:
//   owner  - full setup: profile, billing, clients, tasks, time, revenue, team
//   admin  - same minus owner-only Revenue (admins get Reports instead)
//   member - personal only: profile, tasks, time (no billing/clients/reports/team they can't touch)
export type Role = 'owner' | 'admin' | 'member'

export type TourStep = {
  // May include a query string (e.g. '/settings?view=profile'); TourProvider matches on the
  // pathname portion and navigates to the full path so deep-linked settings tabs open directly.
  path: string
  selector: string
  title: string
  description: string
  roles: Role[]
  // Steps where the user actually types/selects on the page get a lighter dimming overlay so the
  // fields they're filling (especially a form that opens below the highlight) stay clearly legible.
  interactive?: boolean
  // Preferred popover placement relative to the highlight. Omit to let driver.js auto-fit; set it
  // where a fixed side keeps the popover clear of the inputs the user needs to reach.
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
}

const ALL: Role[] = ['owner', 'admin', 'member']
const MANAGERS: Role[] = ['owner', 'admin']

const TOUR_STEPS: TourStep[] = [
  {
    path: '/dashboard',
    selector: '[data-tour="nav-dashboard"]',
    title: 'Welcome to Verdolo',
    description:
      "This quick tour walks you through each page and shows exactly where to enter your info. Takes about two minutes, and you can skip anytime with the X.",
    roles: ALL,
  },
  {
    path: '/settings?view=profile',
    selector: '[data-tour="display-name"]',
    title: 'Set your nickname',
    description:
      'Type the name you want shown across tasks, messages and the team here - it replaces your email everywhere. You can add a profile picture just above too.',
    roles: ALL,
    interactive: true,
  },
  {
    path: '/settings?view=general',
    selector: '[data-tour="billing-currency"]',
    title: 'Pick your billing currency',
    description:
      'Choose the currency your clients actually pay you in - USD, GBP, or EUR. It sets the symbol everywhere: Reports, Revenue, Clients, and invoices.',
    roles: MANAGERS,
    interactive: true,
  },
  {
    path: '/settings?view=general',
    selector: '[data-tour="target-hourly-rate"]',
    title: 'Set your target hourly rate',
    description:
      'Enter what you want to realize per hour here. Verdolo compares it against your effective rate in Reports → Profitability and Revenue, so you can see which clients are actually worth it.',
    roles: MANAGERS,
    interactive: true,
  },
  {
    path: '/clients',
    selector: '[data-tour="clients-add-region"]',
    title: 'Add your first client',
    description:
      'Click "+ New client" to create one, then fill in the whole form right here - the tour stays open. Give it a name, choose Retainer or Hourly and enter the rate; that number drives your reports, revenue, and invoices, so it\'s worth getting right. Hit Next when you\'re done.',
    roles: MANAGERS,
    interactive: true,
  },
  {
    path: '/tasks',
    selector: '[data-tour="add-task-button"]',
    title: 'Add your first task',
    description:
      'Hit "+ New task" to capture work. Quick mode just needs a title; detailed mode lets you set a client, assignee, due date and priority. This is your day-to-day to-do list.',
    roles: ALL,
    interactive: true,
  },
  {
    path: '/tasks',
    selector: '[data-tour="task-timer"]',
    title: 'Time a task',
    description:
      'Hit the play button next to a task to start a live timer against it - it turns into a pause button while running. That logged time flows straight into your Time page and effective-rate reporting, no manual entry needed.',
    roles: ALL,
    interactive: true,
  },
  {
    path: '/tasks',
    selector: '[data-tour="task-checkbox"]',
    title: 'Complete a task',
    description:
      'Click the circle to the left of a task to mark it done. Completed tasks feed your reports and, for client work, your revenue and effective-rate numbers.',
    roles: ALL,
    interactive: true,
  },
  {
    path: '/tasks',
    selector: '[data-tour="task-actions"]',
    title: 'Snooze, skip and more',
    description:
      'Hover a task and these actions appear on the right: the clock logs time manually, the moon snoozes it to tomorrow, skip drops a single recurring occurrence, and the trash deletes it. Quick housekeeping without opening the task.',
    roles: ALL,
    interactive: true,
  },
  {
    path: '/time',
    selector: '[data-tour="start-timer"]',
    title: 'Track your time',
    description:
      'Pick a client (and optionally a task) and hit Start, or use "Log time manually" below to backfill hours you already worked. Time logged here powers effective-rate and profitability reporting.',
    roles: ALL,
    interactive: true,
  },
  {
    path: '/revenue',
    selector: '[data-tour="revenue-summary"]',
    title: 'See your revenue',
    description:
      'Revenue rolls up retainers plus extra billables against the hours logged each period, and flags MRR that\'s at risk. This is your owner-only money view.',
    roles: ['owner'],
  },
  {
    path: '/reports',
    selector: '[data-tour="reports-summary"]',
    title: 'Check your reports',
    description:
      'Reports show client activity, profitability against your target rate, and team capacity. Use Profitability to spot which clients are under-earning for the hours they take.',
    roles: ['admin'],
  },
  {
    path: '/team',
    selector: '[data-tour="invite-teammate"]',
    title: 'Invite your team',
    description:
      "Enter a teammate's email and pick their role to bring them into the org. Owners see everything, admins run day-to-day, members focus on their own tasks and time.",
    roles: MANAGERS,
    interactive: true,
  },
  {
    path: '/dashboard',
    selector: '[data-tour="nav-dashboard"]',
    title: "You're all set",
    description:
      "That's the tour. Your Dashboard is home base - it surfaces what needs attention each day. You can replay this tour anytime from Settings → Profile.",
    roles: ALL,
  },
]

export function stepsForRole(role: Role): TourStep[] {
  return TOUR_STEPS.filter((s) => s.roles.includes(role))
}

// Progress + replay state live in localStorage so they survive the full page load between steps.
export function tourStepKey(orgId: string) {
  return `verdolo-tour-step-${orgId}`
}
export function tourReplayKey(orgId: string) {
  return `verdolo-tour-replay-${orgId}`
}

// Called by the "Replay guided tour" button (any role, any time). Arms the replay flag, resets to
// the first step, and hard-navigates to the tour's opening page so TourProvider picks it up fresh.
export function startTourReplay(orgId: string) {
  localStorage.setItem(tourReplayKey(orgId), '1')
  localStorage.setItem(tourStepKey(orgId), '0')
  window.location.assign('/dashboard')
}
