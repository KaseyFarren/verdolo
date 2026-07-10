import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Profile-picture upload runs server-side with the service-role key, which bypasses storage
// RLS. The avatars-bucket RLS insert policy has repeatedly failed to land in prod (see
// migrations 0011 + 0022), so direct browser uploads got "new row violates row-level security
// policy". Doing it here removes that dependency entirely - and it's tighter security, because
// the destination folder is derived from the authenticated session, never from client input,
// so nobody can write to another user's folder regardless of what they post.

const MAX_AVATAR_BYTES = 3 * 1024 * 1024
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

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

  const admin = createAdminClient()
  // Folder is the authenticated user's id - not anything the client sent.
  const path = `${user.id}/avatar.${EXT[file.type]}`
  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await admin.storage.from('avatars').upload(path, buffer, { upsert: true, contentType: file.type })
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 })

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
