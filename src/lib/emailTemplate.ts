import 'server-only'

export function renderEmail({
  preheader,
  heading,
  bodyHtml,
  ctaText,
  ctaUrl,
  footerNote,
}: {
  preheader: string
  heading: string
  bodyHtml: string
  ctaText?: string
  ctaUrl?: string
  footerNote?: string
}) {
  const cta =
    ctaText && ctaUrl
      ? `<tr>
          <td align="center" style="padding: 28px 40px 8px 40px;">
            <a href="${ctaUrl}" target="_blank" style="display:inline-block; background-color:#dd6b2c; color:#ffffff; font-size:15px; font-weight:600; text-decoration:none; padding:12px 32px; border-radius:8px;">${ctaText}</a>
          </td>
        </tr>`
      : ''

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Verdolo</title>
  </head>
  <body style="margin:0; padding:0; background-color:#ece2d5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ece2d5;">
      <tr>
        <td align="center" style="padding: 40px 16px;">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px; max-width:100%; background-color:#f7f1ea; border-radius:16px; overflow:hidden;">
            <tr>
              <td align="center" style="padding: 36px 40px 8px 40px;">
                <img src="https://app.verdolo.com/icon.png" width="48" height="48" alt="Verdolo" style="display:block; border-radius:12px;" />
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 16px 40px 0 40px;">
                <h1 style="margin:0; font-size:21px; line-height:1.3; font-weight:700; color:#1a1a17;">${heading}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding: 12px 40px 0 40px; font-size:16px; line-height:1.6; color:#1a1a17;">
                ${bodyHtml}
              </td>
            </tr>
            ${cta}
            ${
              footerNote
                ? `<tr><td align="center" style="padding: 16px 40px 0 40px; font-size:13px; line-height:1.5; color:#5d6b5c;">${footerNote}</td></tr>`
                : ''
            }
            <tr>
              <td align="center" style="padding: 32px 40px 36px 40px; font-size:12px; color:#5d6b5c;">
                Verdolo &middot; <a href="https://app.verdolo.com" target="_blank" style="color:#5d6b5c;">app.verdolo.com</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

/** HTML-escapes user-supplied text (task titles, names, message bodies) before it goes into an email. */
export function esc(text: string | null | undefined) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** The one clear "details" box the email standards ask for - key info that can't be missed. */
export function detailsBox(innerHtml: string) {
  return `<div style="margin:16px 0 0 0; padding:16px 18px; background-color:#ffffff; border-radius:12px; border:1px solid #e6dccf;">${innerHtml}</div>`
}

export const APP_URL = process.env.APP_URL || 'https://app.verdolo.com'
