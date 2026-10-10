'use client'
import { useState } from 'react'

export function LogoutButton() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  return <span>
    <button type="button" disabled={pending} className="text-xs opacity-70 px-2" onClick={async () => {
      setPending(true); setError(false)
      try {
        const response = await fetch('/api/auth/logout', { method: 'POST' })
        if (!response.ok) throw new Error()
        // Reset client data and in-memory caches rather than preserve the old UI.
        window.location.replace('/login')
      } catch { setError(true); setPending(false) }
    }}>{pending ? '退出中…' : '退出'}</button>
    {error && <span role="alert" className="text-xs text-red-500">退出失败</span>}
  </span>
}
