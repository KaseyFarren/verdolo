'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useConfirm } from '@/components/ConfirmDialog'
import { clearPin, getIdleMinutes, hasPinSet, setIdleMinutes, setPin } from '@/components/PinLock'
import { Row, Section } from '@/components/settings/SettingsUI'
import Button from '@/components/ui/Button'

export default function SecurityClient() {
  return (
    <>
      <PasswordSection />
      <PinSection />
    </>
  )
}

function PasswordSection() {
  const supabase = useMemo(() => createClient(), [])
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)

  async function changePassword() {
    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords don’t match')
      return
    }
    setSaving(true)
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    setSaving(false)
    if (updateError) {
      toast.error(updateError.message)
      return
    }
    setNewPassword('')
    setConfirmPassword('')
    toast.success('Password updated')
  }

  return (
    <Section label="Password">
      <div className="text-sm font-medium mb-1">Change password</div>
      <div className="text-xs text-sage mb-3">Updates the password used to log in</div>
      <div>
        <div className="flex gap-2 mb-2">
          <input
            type="password"
            placeholder="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="flex-1 rounded border border-ink/10 bg-white px-3 py-2 text-sm"
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="flex-1 rounded border border-ink/10 bg-white px-3 py-2 text-sm"
          />
        </div>
        <Button variant="primary" onClick={changePassword} disabled={saving || !newPassword}>
          {saving ? 'Updating…' : 'Update password'}
        </Button>
      </div>
    </Section>
  )
}

function PinSection() {
  const confirm = useConfirm()
  const [hasPin, setHasPin] = useState(false)
  const [idleMinutes, setIdleMinutesState] = useState(5)
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [changing, setChanging] = useState(false)

  useEffect(() => {
    setHasPin(hasPinSet())
    setIdleMinutesState(getIdleMinutes())
  }, [])

  async function savePin() {
    if (!/^\d{4,6}$/.test(newPin)) {
      toast.error('PIN must be 4-6 digits')
      return
    }
    if (newPin !== confirmPin) {
      toast.error('PINs don’t match')
      return
    }
    await setPin(newPin)
    setHasPin(true)
    setChanging(false)
    setNewPin('')
    setConfirmPin('')
    toast.success('PIN set for this device')
  }

  async function removePin() {
    const ok = await confirm({ title: 'Remove PIN lock?', message: 'The app will no longer lock on this device.', confirmLabel: 'Remove', danger: true })
    if (!ok) return
    clearPin()
    setHasPin(false)
    toast.success('PIN removed')
  }

  function changeIdle(v: number) {
    setIdleMinutesState(v)
    setIdleMinutes(v)
  }

  return (
    <Section label="Device PIN lock">
      <Row title="Device PIN lock" subtitle="Locks this browser after inactivity - a quick deterrent, not a replacement for your login">
        {hasPin && !changing ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-green">● PIN set</span>
            <button className="text-xs rounded border border-ink/10 px-2 py-1" onClick={() => setChanging(true)}>
              Change
            </button>
            <button className="text-xs text-red-600" onClick={removePin}>
              Remove
            </button>
          </div>
        ) : (
          <button className="text-xs rounded border border-ink/10 px-2 py-1" onClick={() => setChanging(true)}>
            {changing ? 'Cancel' : 'Set PIN'}
          </button>
        )}
      </Row>
      {changing && (
        <div className="pt-2.5">
          <div className="flex gap-2 mb-2">
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder="New PIN"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
              className="flex-1 rounded border border-ink/10 bg-white px-3 py-2 text-sm"
            />
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder="Confirm PIN"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              className="flex-1 rounded border border-ink/10 bg-white px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button className="rounded border border-ink/10 px-3 py-1.5 text-sm" onClick={() => setChanging(false)}>
              Cancel
            </button>
            <Button variant="primary" className="!px-3 !py-1.5" onClick={savePin}>
              Save PIN
            </Button>
          </div>
        </div>
      )}
      {hasPin && (
        <Row title="Lock after" subtitle="Minutes of inactivity before locking">
          <select
            value={idleMinutes}
            onChange={(e) => changeIdle(Number(e.target.value))}
            className="rounded border border-ink/10 bg-white px-2 py-1.5 text-sm"
          >
            {[2, 5, 10, 15, 30].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </Row>
      )}
    </Section>
  )
}
