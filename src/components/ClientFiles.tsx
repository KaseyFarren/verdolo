'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AnimatePresence, motion } from 'motion/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import Button from '@/components/ui/Button'
import IconButton from '@/components/ui/IconButton'
import { FileIcon, ImageFileIcon, PdfFileIcon, SheetFileIcon, TrashIcon, UploadCloudIcon } from '@/components/ui/icons'

type ClientFile = { id: string; file_name: string; storage_path: string; size_bytes: number | null; created_at: string }

const MAX_FILE_BYTES = 50 * 1024 * 1024

function formatSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function extOf(fileName: string) {
  const i = fileName.lastIndexOf('.')
  return i === -1 ? '' : fileName.slice(i + 1).toLowerCase()
}

function FileTypeIcon({ fileName, size }: { fileName: string; size: number }) {
  const ext = extOf(fileName)
  if (ext === 'pdf') return <PdfFileIcon size={size} />
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic'].includes(ext)) return <ImageFileIcon size={size} />
  if (['xls', 'xlsx', 'csv', 'numbers'].includes(ext)) return <SheetFileIcon size={size} />
  return <FileIcon size={size} />
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
  const [pending, setPending] = useState<{ file: File; name: string } | null>(null)

  useEffect(() => {
    supabase
      .from('client_files')
      .select('id, file_name, storage_path, size_bytes, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error) setFiles((data as ClientFile[]) ?? [])
        else toast.error('Could not load files')
      })
  }, [supabase, clientId])

  async function upload(file: File, displayName: string) {
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
      .insert({ org_id: orgId, client_id: clientId, file_name: displayName, storage_path: path, size_bytes: file.size })
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
                if (file) {
                  if (file.size > MAX_FILE_BYTES) {
                    toast.error(`That file is too large - uploads are limited to ${formatSize(MAX_FILE_BYTES)}`)
                  } else {
                    setPending({ file, name: file.name })
                  }
                }
                e.target.value = ''
              }}
            />
          </label>
        )}
      </div>

      {files.length === 0 ? (
        <div className="text-sm text-sage py-2">No files yet - brand guides, docs, or other reference material.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {files.map((f) => (
            <div
              key={f.id}
              className="group relative flex flex-col gap-2 rounded-xl border border-ink/10 bg-white p-3 text-left hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer"
              onClick={() => download(f)}
            >
              {canEdit && (
                <IconButton
                  label="Delete"
                  tone="red"
                  icon={<TrashIcon size={13} />}
                  className="absolute top-1.5 right-1.5 bg-white/90 opacity-0 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    remove(f)
                  }}
                />
              )}
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-sand text-sage shrink-0">
                <FileTypeIcon fileName={f.storage_path} size={17} />
              </div>
              <div className="text-xs font-medium leading-snug line-clamp-2 break-words">{f.file_name}</div>
              <div className="text-xs text-sage">{formatSize(f.size_bytes)}</div>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {pending && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => !uploading && setPending(null)}
          >
            <motion.div
              className="w-full max-w-sm rounded-2xl border border-ink/10 bg-white p-5 shadow-xl"
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-sand text-sage shrink-0">
                  <UploadCloudIcon size={16} />
                </div>
                <div className="text-sm font-semibold">Name this file</div>
              </div>
              <div className="text-xs text-sage mb-4">This is how it&rsquo;ll show up in the file library - rename it to whatever&rsquo;s clearest.</div>
              <input
                className="w-full rounded border border-ink/10 bg-white px-3 py-2 text-sm mb-4"
                value={pending.name}
                autoFocus
                disabled={uploading}
                onChange={(e) => setPending((p) => (p ? { ...p, name: e.target.value } : p))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && pending.name.trim() && !uploading) {
                    upload(pending.file, pending.name.trim()).then(() => setPending(null))
                  }
                }}
              />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" disabled={uploading} onClick={() => setPending(null)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={uploading || !pending.name.trim()}
                  onClick={() => upload(pending.file, pending.name.trim()).then(() => setPending(null))}
                >
                  {uploading ? 'Uploading…' : 'Upload'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
