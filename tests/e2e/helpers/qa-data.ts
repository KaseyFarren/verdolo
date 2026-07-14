// Shared helpers for e2e tests that create real prod-backed data. Everything created by tests
// is tagged with this prefix so it's identifiable and safe to sweep up, since there's no
// staging environment (tests run against the real kaseyfarren org - see memory
// project_verdolo_e2e_test_suite / feedback_no_staging_tier).
export const QA_PREFIX = 'PW-QA-'

export function qaName(label: string) {
  return `${QA_PREFIX}${label}-${Date.now()}`
}
