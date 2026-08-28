// Guided tour for a brand-new user. A custom overlay (TourProvider) drives it: it spotlights the
// relevant element with a rounded cutout, docks a guide card in whatever empty margin is available
// so it never sits on top of page content, and can auto-advance when the user performs the step's
// action (save, add, start a timer, complete a task). Steps are role-aware and walk the user across
// the actual pages they'll use, via a hard navigation between steps.
export type Role = 'owner' | 'admin' | 'member'

export type TourStep = {
  // May include a query string (e.g. '/settings?view=profile'); TourProvider matches on the
  // pathname portion and navigates to the full path so deep-linked settings tabs open directly.
  path: string
  // Element to spotlight. Empty string = no spotlight (card is centered) - used for intro/outro.
  selector: string
  title: string
  description: string
  roles: Role[]
  // Clicking an element matching this selector advances the tour - so finishing the step's real
  // action (Save, Add, play, complete) moves things along without a separate "Next" click.
  advanceOn?: string
}

const ALL: Role[] = ['owner', 'admin', 'member']
const MANAGERS: Role[] = ['owner', 'admin']

const TOUR_STEPS: TourStep[] = [
  {
    path: '/dashboard',
    selector: '',
    title: 'Welcome to Verdolo',
    description:
      "This quick tour walks you through each page and shows exactly where to enter your info. It takes about two minutes - hit Next to begin, or close it anytime with the X.",
    roles: ALL,
  },
  {
    path: '/settings?view=profile',
    selector: '[data-tour="display-name"]',
    title: 'Set your nickname',
    description:
      'Type the name you want shown across tasks, messages and the team - it saves as you type and replaces your email everywhere. You can add a profile picture just above.',
    roles: ALL,
  },
  {
    path: '/settings?view=general',
    selector: '[data-tour="currency-row"]',
    title: 'Pick your billing currency',
    description:
      'Choose the currency your clients actually pay you in - USD, GBP, or EUR. It sets the symbol everywhere: Reports, Revenue, and Clients.',
    roles: MANAGERS,
  },
  {
    path: '/settings?view=general',
    selector: '[data-tour="rate-row"]',
    title: 'Set your target hourly rate',
    description:
      'Enter what you want to realize per hour - it saves as you type. Verdolo compares it against your effective rate in Reports and Revenue, so you can see which clients are actually worth it.',
    roles: MANAGERS,
  },
  {
    path: '/clients',
    selector: '[data-tour="clients-add-region"]',
    title: 'Add your first client',
    description:
      'Click "+ New client", fill in the highlighted form, and press its Save button - that adds the client and moves the tour on automatically. The name plus Retainer/Hourly rate is what drives your reports and revenue.',
    roles: MANAGERS,
    advanceOn: '[data-tour-advance="save-client"]',
  },
  {
    path: '/proposals',
    selector: '[data-tour="new-proposal-button"]',
    title: 'Send a proposal',
    description:
      'Click "+ New proposal" to draft one for a client and track it here - Draft, Sent, Signed or Declined - right through to close.',
    roles: MANAGERS,
  },
  {
    path: '/tasks',
    selector: '[data-tour="add-task-region"]',
    title: 'Add your first task',
    description:
      'Hit "+ New task", then Add task to save it - that moves the tour on. Quick mode just needs a title; detailed mode lets you set a client, one or more assignees, due date and priority. This is your day-to-day to-do list.',
    roles: ALL,
    advanceOn: '[data-tour-advance="add-task"]',
  },
  {
    path: '/tasks',
    selector: '[data-tour="import-from-doc"]',
    title: 'Import tasks from a doc',
    description:
      'Paste a transcript or upload a file here and Verdolo\'s AI turns it into a batch of draft tasks you review before adding - handy after a call or when you\'re handed a scope doc.',
    roles: ALL,
  },
  {
    path: '/tasks',
    selector: '[data-tour="task-timer"]',
    title: 'Time a task',
    description:
      'Hit the play button on a task to start a live timer against it - the tour moves on as soon as you do. It turns into a pause button while running, and that time flows straight into your Time page and effective-rate reporting.',
    roles: ALL,
    advanceOn: '[data-tour="task-timer"]',
  },
  {
    path: '/tasks',
    selector: '[data-tour="task-actions"]',
    title: 'Snooze, skip and more',
    description:
      'Hover a task and these actions appear on the right: the clock logs time manually, the moon snoozes it to tomorrow, skip drops a single recurring occurrence, and the trash deletes it - quick housekeeping without opening the task. Hit Next when you\'re ready.',
    roles: ALL,
  },
  {
    path: '/tasks',
    selector: '[data-tour="task-checkbox"]',
    title: 'Complete a task',
    description:
      'Click the circle to the left of a task to mark it done - that completes the step. Finished tasks feed your reports and, for client work, your revenue and effective-rate numbers.',
    roles: ALL,
    advanceOn: '[data-tour="task-checkbox"]',
  },
  {
    path: '/tasks',
    selector: '[data-tour="add-subtask"]',
    title: 'Break a task into subtasks',
    description:
      'Click "+ Add subtask" under any task to split it into smaller steps - the parent can\'t be completed until they\'re all done.',
    roles: ALL,
  },
  {
    path: '/tasks',
    selector: '[data-tour="tasks-board-tab"]',
    title: 'Switch to board view',
    description:
      'Click "Board" for a Kanban view - drag tasks between columns to update their status. Same tasks as the list, just a different way to work through them.',
    roles: ALL,
    advanceOn: '[data-tour="tasks-board-tab"]',
  },
  {
    path: '/projects',
    selector: '[data-tour="new-project-button"]',
    title: 'Group work into projects',
    description:
      'Click "+ New project" to create one, then break it into phases inside - tasks slot into a phase so you can track progress project-by-project, not just client-by-client.',
    roles: ALL,
  },
  {
    path: '/time',
    selector: '[data-tour="start-timer"]',
    title: 'Track your time',
    description:
      'Pick a client (and optionally a task) and hit Start, or use "Log time manually" below to backfill hours you already worked. Time logged here powers your effective-rate and profitability reporting.',
    roles: ALL,
  },
  {
    path: '/messages',
    selector: '[data-tour="message-composer"]',
    title: 'Message your team',
    description:
      'The team channel is open by default - type here to post, or start a DM from the list on the left. Type @ to mention someone, or turn any message into a task.',
    roles: ALL,
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
    path: '/revenue',
    selector: '[data-tour="revenue-billables"]',
    title: 'Add extra billables',
    description:
      'Click any client row here to expand it, then log one-off charges - ad spend, a design add-on, anything beyond the retainer. They roll into that client\'s revenue for the period straight away.',
    roles: ['owner'],
  },
  {
    path: '/reports',
    selector: '[data-tour="reports-recap"]',
    title: 'AI weekly & monthly reports',
    description:
      'Verdolo writes you a plain-English recap of the week or month - what got done, where time went, which clients need attention. Generate one here anytime, and the library below keeps them all.',
    roles: MANAGERS,
  },
  {
    path: '/team',
    selector: '[data-tour="invite-teammate"]',
    title: 'Invite your team',
    description:
      "Enter a teammate's email and pick their role to bring them into the org. Owners see everything, admins run day-to-day, members focus on their own tasks and time.",
    roles: MANAGERS,
  },
  {
    path: '/dashboard',
    selector: '',
    title: "You're all set",
    description:
      "That's the tour. Your Dashboard is home base - it surfaces what needs attention each day. You can replay this anytime from Settings → Profile.",
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
