import 'server-only'

type GmailHeader = { name: string; value: string }
type GmailMessage = {
  id: string
  threadId: string
  snippet: string
  payload: { headers: GmailHeader[] }
  internalDate: string
}

function header(msg: GmailMessage, name: string) {
  return msg.payload.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

/** Pulls the bare email address out of a "Name <email@domain.com>" style header. */
export function extractEmail(headerValue: string) {
  const match = headerValue.match(/<([^>]+)>/)
  return (match ? match[1] : headerValue).trim().toLowerCase()
}

export async function listRecentMessageIds(accessToken: string, maxResults = 30) {
  const url = `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent('newer_than:30d')}&maxResults=${maxResults}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`Gmail list failed: ${res.status}`)
  const data = await res.json()
  return (data.messages || []) as { id: string; threadId: string }[]
}

export async function getMessage(accessToken: string, id: string) {
  const url = `https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`Gmail get failed: ${res.status}`)
  const msg = (await res.json()) as GmailMessage
  return {
    id: msg.id,
    threadId: msg.threadId,
    snippet: msg.snippet,
    from: header(msg, 'From'),
    to: header(msg, 'To'),
    subject: header(msg, 'Subject'),
    messageId: header(msg, 'Message-ID'),
    date: new Date(Number(msg.internalDate)).toISOString(),
  }
}

function buildRawEmail(params: { to: string; from: string; subject: string; body: string; inReplyTo?: string; references?: string }) {
  const lines = [
    `To: ${params.to}`,
    `From: ${params.from}`,
    `Subject: ${params.subject}`,
    params.inReplyTo ? `In-Reply-To: ${params.inReplyTo}` : '',
    params.references ? `References: ${params.references}` : '',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    params.body,
  ].filter(Boolean)
  const raw = lines.join('\r\n')
  return Buffer.from(raw).toString('base64url')
}

export async function sendGmailMessage(
  accessToken: string,
  params: { to: string; from: string; subject: string; body: string; threadId?: string; inReplyTo?: string; references?: string }
) {
  const res = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: buildRawEmail(params), threadId: params.threadId }),
  })
  if (!res.ok) throw new Error(`Gmail send failed: ${res.status}`)
  return res.json()
}
