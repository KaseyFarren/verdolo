'use client'

import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

export type RunningTimer = { id: string; task_id: string | null; client_id: string | null; started_at: string }

/** Tracks at most one running (task-linked) timer per user, matching typical single-active-timer UX:
 * starting a new task's timer auto-stops whatever was running before. */
export function useTaskTimer(supabase: SupabaseClient, orgId: string, userId: string) {
  const [running, setRunning] = useState<RunningTimer | null>(null)
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    supabase
      .from('time_entries')
      .select('id, task_id, client_id, started_at')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .is('ended_at', null)
      .maybeSingle()
      .then(({ data }) => setRunning(data as RunningTimer | null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!running) {
      setNow(null)
      return
    }
    setNow(Date.now())
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [running?.id])

  async function stopRunning() {
    if (!running) return null
    const endedAt = new Date()
    const startedAt = new Date(running.started_at)
    const durationSeconds = Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
    await supabase.from('time_entries').update({ ended_at: endedAt.toISOString(), duration_seconds: durationSeconds }).eq('id', running.id)
    setRunning(null)
    return durationSeconds
  }

  /** No-op if this task's timer is already the one running. */
  async function startForTask(task: { id: string; client_id: string | null }) {
    if (running?.task_id === task.id) return
    if (running) await stopRunning()
    const { data } = await supabase
      .from('time_entries')
      .insert({ org_id: orgId, client_id: task.client_id, task_id: task.id, user_id: userId, started_at: new Date().toISOString(), billable: true })
      .select('id, task_id, client_id, started_at')
      .single()
    if (data) setRunning(data as RunningTimer)
  }

  /** Stops the timer if it belongs to this task — call when a task is marked done. */
  async function stopIfRunningFor(taskId: string) {
    if (running?.task_id === taskId) await stopRunning()
  }

  function elapsedFor(taskId: string) {
    if (!running || running.task_id !== taskId || !now) return null
    const seconds = Math.max(0, Math.floor((now - new Date(running.started_at).getTime()) / 1000))
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
  }

  return { running, startForTask, stopRunning, stopIfRunningFor, elapsedFor }
}
