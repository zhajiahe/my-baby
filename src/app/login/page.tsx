'use client'

import { useState, type FormEvent } from 'react'

export default function Login() {
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError('')
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      setPassword('')
      if (response.ok) { window.location.assign('/'); return }
      setError(response.status === 429 ? '尝试次数过多，请稍后再试。' : response.status === 503 ? '服务尚未配置登录凭证，请联系管理员。' : '登录失败，请检查密码。')
    } catch { setError('网络错误，请稍后重试。') }
    finally { setPending(false) }
  }
  return <main className="min-h-screen flex items-center justify-center px-4">
    <form onSubmit={submit} className="w-full max-w-sm rounded-2xl p-8 space-y-5" style={{ background: 'var(--card-bg, var(--background))' }}>
      <h1 className="text-2xl font-bold">小好小宇宙</h1>
      <p className="text-sm">请输入家庭访问密码，查看宝宝成长记录。</p>
      <label className="block">访问密码
        <input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required maxLength={1024}
          className="mt-2 w-full rounded-lg border p-3" style={{ background: 'var(--background)', color: 'var(--foreground)' }} />
      </label>
      {error && <p role="alert" className="text-red-500 text-sm">{error}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-teal-600 p-3 text-white disabled:opacity-50">{pending ? '正在登录…' : '登录'}</button>
    </form>
  </main>
}
