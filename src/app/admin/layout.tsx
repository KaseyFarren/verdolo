import { requireAppOwnerPage } from '@/lib/admin-auth'
import AdminShell from './AdminShell'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAppOwnerPage()

  return <AdminShell userEmail={user.email}>{children}</AdminShell>
}
