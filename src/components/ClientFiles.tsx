'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { SupabaseClient } from '@supabase/supabase-js'
import IconButton from '@/components/ui/IconButton'
import { TrashIcon } from '@/components/ui/icons'

type ClientFile = { id: string; file_name: string; storage_path: string; size_bytes: number | null; created_at: string }

function formatSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function ClientFiles({
  supabase,
  orgId,
  clientId,
  canEdit,
}: {
  supabase: SupabaseClient
  orgId: string
  clientId: string
  canEdit: boolean
}) {
  const [files, setFiles] = useState<ClientFile[]>([])
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    supabase
      .from('client_files')
      .select('id, file_name, storage_path, size_bytes, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error) setFiles((data as ClientFile[]) ?? [])
      })
  }, [supabase, clientId])

  async function upload(file: File) {
    setUploading(true)
    const path = `${orgId}/${clientId}/${Date.now()}-${file.name}`
    const { error: uploadError } = await supabase.storage.from('client-files').upload(path, file)
    if (uploadError) {
      toast.error('Upload failed')
      setUploading(false)
      return
    }
    const { data, error } = await supabase
      .from('client_files')
      .insert({ org_id: orgId, client_id: clientId, file_name: file.name, storage_path: path, size_bytes: file.size })
      .select('id, file_name, storage_path, size_bytes, created_at')
      .single()
    if (!error && data) setFiles((prev) => [data as ClientFile, ...prev])
    else toast.error('Upload failed')
    setUploading(false)
  }

  async function download(file: ClientFile) {
    const { data, error } = await supabase.storage.from('client-files').createSignedUrl(file.storage_path, 60)
    if (error || !data) {
      toast.error('Could not open file')
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  async function remove(file: ClientFile) {
    await supabase.storage.from('client-files').remove([file.storage_path])
    await supabase.from('client_files').delete().eq('id', file.id)
    setFiles((prev) => prev.filter((f) => f.id !== file.id))
  }

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-sage">Files</div>
        {canEdit && (
          <label className="text-xs text-accent font-medium cursor-pointer">
            {uploading ? 'Uploading…' : '+ Upload'}
            <input
              type="file"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) upload(file)
                e.target.value = ''
              }}
            />
          </label>
        )}
      </div>
      {files.length === 0 ? (
        <div className="text-sm text-sage py-2">No files yet — brand guides, docs, or other reference material.</div>
      ) : (
        <div className="flex flex-col">
          {files.map((f) => (
            <div key={f.id} className="flex items-center justify-between py-2 border-b border-ink/5 last:border-0 text-sm">
              <button className="text-left truncate pr-2 hover:underline" onClick={() => download(f)}>
                {f.file_name}
              </button>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-sage">{formatSize(f.size_bytes)}</span>
                {canEdit && <IconButton label="Delete" tone="red" icon={<TrashIcon size={14} />} onClick={() => remove(f)} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
