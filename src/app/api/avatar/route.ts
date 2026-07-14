import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/apiError'

// Identify the real image type from the file's magic bytes, so a client can't smuggle other
// content in by spoofing the multipart Content-Type. Returns null if it's not one we allow.
function sniffImageType(buf: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 6 && (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a')) return 'image/gif'
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}

// Profile-picture upload runs server-side with the service-role key, which bypasses storage
// RLS. The avatars-bucket RLS insert policy has repeatedly failed to land in prod (see
// migrations 0011 + 0022), so direct browser uploads got "new row violates row-level security
// policy". Doing it here removes that dependency entirely - and it's tighter security, because
// the destination folder is derived from the authenticated session, never from client input,
// so nobody can write to another user's folder regardless of what they post.

const MAX_AVATAR_BYTES = 3 * 1024 * 1024
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const AVATAR_SIZE = 512

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (!ALLOWED.has(file.type)) return NextResponse.json({ error: 'Please choose a PNG, JPG, WebP or GIF image' }, { status: 400 })
  if (file.size > MAX_AVATAR_BYTES) return NextResponse.json({ error: 'Image must be under 3MB' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  // Trust the file's own bytes, not the client-supplied Content-Type, for what actually gets
  // stored and served from the public avatars bucket.
  const sniffed = sniffImageType(buffer)
  if (!sniffed) return NextResponse.json({ error: 'That file is not a valid PNG, JPG, WebP or GIF image' }, { status: 400 })

  // Decode and re-encode through sharp rather than storing the uploaded bytes verbatim. This
  // strips EXIF/metadata and discards anything appended after the image data (polyglot files),
  // since only the decoded pixels survive. It also doubles as a stronger validity check than the
  // magic-byte sniff above - sharp throws on anything that isn't a genuinely decodable image.
  let resized: Buffer
  try {
    resized = await sharp(buffer)
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
      .webp({ quality: 82 })
      .toBuffer()
  } catch {
    return NextResponse.json({ error: 'That file is not a valid PNG, JPG, WebP or GIF image' }, { status: 400 })
  }

  const admin = createAdminClient()
  // Folder is the authenticated user's id - not anything the client sent. Output is always
  // re-encoded to webp, so the stored extension no longer depends on what was uploaded.
  const path = `${user.id}/avatar.webp`
  const { error: upErr } = await admin.storage.from('avatars').upload(path, resized, { upsert: true, contentType: 'image/webp' })
  if (upErr) return apiError('Could not upload your picture', 500, upErr)

  const { data: pub } = admin.storage.from('avatars').getPublicUrl(path)
  // Cache-bust so the new picture shows immediately even though the storage path is stable.
  const url = `${pub.publicUrl}?t=${Date.now()}`
  // avatar_url lives per membership row; update every org this user belongs to so their picture
  // is consistent everywhere.
  const { error: updErr } = await admin.from('org_members').update({ avatar_url: url }).eq('user_id', user.id)
  if (updErr) return NextResponse.json({ error: 'Could not save your picture' }, { status: 500 })

  return NextResponse.json({ url })
}

export async function DELETE() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const admin = createAdminClient()
  // Remove any stored files under the user's folder (extension may vary), then clear the column.
  const { data: existing } = await admin.storage.from('avatars').list(user.id)
  if (existing?.length) {
    await admin.storage.from('avatars').remove(existing.map((f) => `${user.id}/${f.name}`))
  }
  const { error } = await admin.from('org_members').update({ avatar_url: null }).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: 'Could not remove your picture' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
