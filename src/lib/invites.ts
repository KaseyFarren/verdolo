import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { APP_URL, detailsBox, esc, renderEmail } from '@/lib/emailTemplate'

/**
 * Creates (or re-issues) a one-time setup link and emails it ourselves, instead of Supabase's
 * built-in invite email. Why:
 *  - the built-in template is one generic "join a team ... for agencies" text for everyone,
 *    which is wrong for a client being given a portal;
 *  - inviteUserByEmail refuses an email that already has an auth user, so a link that expired
 *    could never be re-sent ("Resend invite" needs a magic link for the existing user instead).
 * The link lands on /accept-invite, which only verifies on an explicit click (see that page).
 */
export async function issueSetupLink(admin: SupabaseClient, email: string) {
  const invite = await admin.auth.admin.generateLink({ type: 'invite', email })
  if (!invite.error && invite.data.user) {
    return { userId: invite.data.user.id, url: setupUrl(invite.data.properties.hashed_token, 'invite') }
  }
  // Already has an auth user (re-invite, resend, or an existing Verdolo account) - a magic link
  // signs them in the same way, and /accept-invite then finishes whichever invite is pending.
  const magic = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (magic.error || !magic.data.user) {
    return { error: magic.error ?? invite.error ?? new Error('could not create link') }
  }
  return { userId: magic.data.user.id, url: setupUrl(magic.data.properties.hashed_token, 'magiclink') }
}

function setupUrl(tokenHash: string, type: 'invite' | 'magiclink') {
  return `${APP_URL}/accept-invite?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`
}

export async function sendClientInviteEmail({
  to,
  url,
  contactName,
  clientName,
  inviterName,
  inviterEmail,
}: {
  to: string
  url: string
  contactName: string | null
  clientName: string
  inviterName: string
  inviterEmail: string | null
}) {
  const hello = contactName ? `Hi ${esc(contactName.split(' ')[0])},` : 'Hi,'
  const html = renderEmail({
    preheader: `Everything for ${clientName} in one place: what's done, what's next and what's waiting on you.`,
    heading: 'Your project space is ready',
    bodyHtml: `<p style="margin:0 0 12px 0;">${hello}</p>
      <p style="margin:0;">${esc(inviterName)} has set up a shared space for ${esc(clientName)}. It's one list you can both see, so nothing gets forgotten.</p>
      ${detailsBox(`<p style="margin:0 0 6px 0; font-weight:600;">Inside you'll find</p>
        <p style="margin:0;">What ${esc(inviterName)} is working on and when it's due<br />Anything waiting on you, ready to tick off<br />A place to add tasks, ask questions and share files</p>`)}`,
    ctaText: 'Set up my account',
    ctaUrl: url,
    footerNote: `This link works once. If it has expired, just reply to this email and ${esc(inviterName)} will send a new one.`,
  })
  return sendEmail({
    to,
    subject: `${inviterName} set up your project space`,
    html,
    text: `${contactName ? `Hi ${contactName.split(' ')[0]},` : 'Hi,'}\n\n${inviterName} has set up a shared space for ${clientName}. Set up your account here:\n${url}\n\nThis link works once. If it has expired, reply to this email for a new one.`,
    replyTo: inviterEmail ?? undefined,
  })
}

export async function sendTeamInviteEmail({
  to,
  url,
  orgName,
  inviterName,
  inviterEmail,
}: {
  to: string
  url: string
  orgName: string
  inviterName: string
  inviterEmail: string | null
}) {
  const html = renderEmail({
    preheader: `Set a password and you'll see the team's tasks, clients and messages.`,
    heading: `Join ${esc(orgName)} on Verdolo`,
    bodyHtml: `<p style="margin:0;">${esc(inviterName)} has added you to ${esc(orgName)}. Verdolo is where the team keeps its tasks, clients and messages, all in one calm place.</p>`,
    ctaText: 'Accept invite',
    ctaUrl: url,
    footerNote: `This link works once. If it has expired, reply to this email and ${esc(inviterName)} will send a new one.`,
  })
  return sendEmail({
    to,
    subject: `${inviterName} added you to ${orgName}`,
    html,
    text: `${inviterName} has added you to ${orgName} on Verdolo. Accept here:\n${url}`,
    replyTo: inviterEmail ?? undefined,
  })
}

/** Display name + email of the signed-in inviter, for "Kasey set up your project space". */
export async function inviterDetails(admin: SupabaseClient, orgId: string, userId: string, fallbackEmail?: string | null) {
  const { data: m } = await admin.from('org_members').select('display_name, invited_email').eq('org_id', orgId).eq('user_id', userId).maybeSingle()
  const email = fallbackEmail ?? m?.invited_email ?? null
  const name = m?.display_name || (email ? email.split('@')[0] : 'Your team')
  return { name, email }
}
