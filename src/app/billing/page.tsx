import { redirect } from 'next/navigation'

export default function BillingPage() {
  redirect('/settings?view=billing')
}
