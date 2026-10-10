import { randomBytes } from 'node:crypto'
import { writeFile, readFile, stat, mkdir, rename } from 'node:fs/promises'
import { parseEnv } from 'node:util'

async function main() {
  // Do not silently overwrite existing local app settings.
  try { await stat('.env.local'); throw new Error('env_local_already_exists_merge_manually') }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const password = randomBytes(24).toString('base64url'), secret = randomBytes(32).toString('hex')
  let workerSecrets: Record<string, string> = {}
  try {
    const info = await stat('weixin/.local/secrets.json')
    if (info.mode & 0o077) throw new Error('worker_secrets_permissions_must_be_0600')
    workerSecrets = JSON.parse(await readFile('weixin/.local/secrets.json', 'utf8'))
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const agentToken = (workerSecrets.MYBABY_AGENT_TOKEN?.length ?? 0) >= 32
    ? workerSecrets.MYBABY_AGENT_TOKEN : randomBytes(32).toString('hex')
  const contents = [
    '# Generated local-only credentials. Do not commit or paste into chat.',
    `MYBABY_APP_PASSWORD=${password}`, `MYBABY_SESSION_SECRET=${secret}`, `MYBABY_AGENT_TOKEN=${agentToken}`,
    "MYBABY_AGENT_GRANTS='[]'", 'MYBABY_AGENT_WRITES_ENABLED=false', '',
  ].join('\n')
  // parseEnv check catches accidental formatting changes before writing a credential.
  if (parseEnv(contents).MYBABY_APP_PASSWORD !== password) throw new Error('env_format_failed')
  await writeFile('.env.local', contents, { mode: 0o600, flag: 'wx' })
  if (workerSecrets.WEIXIN_ADMIN_TOKEN) {
    await mkdir('weixin/.local', { recursive: true, mode: 0o700 })
    const temp = `weixin/.local/.secrets.${crypto.randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify({ ...workerSecrets, MYBABY_AGENT_TOKEN: agentToken }, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temp, 'weixin/.local/secrets.json')
  }
  console.log('Local .env.local created with 0600 permissions. Credentials were not printed. Read the family password privately; configure grants before enabling Agent access. No Cloudflare/Vercel/database changes made.')
}
main().catch(error => {
  const codes = ['env_local_already_exists_merge_manually', 'worker_secrets_permissions_must_be_0600', 'env_format_failed']
  console.error(error instanceof Error && codes.includes(error.message) ? error.message : 'setup_failed')
  process.exitCode = 1
})
