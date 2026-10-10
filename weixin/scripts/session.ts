import { randomBytes } from 'node:crypto';
import { admin, loadLocal, saveLocal, workerOrigin, type ClientConfig } from './local.js';

async function main(): Promise<void> {
  const [action, arg] = process.argv.slice(2);
  if (action === 'init') {
    try { await loadLocal('client.json'); throw new Error('already_initialized'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const adminToken = randomBytes(32).toString('hex');
    await saveLocal('client.json', { adminToken, ...(arg ? { origin: workerOrigin(arg) } : {}) });
    // cf requires declared secrets on the first deployment. UNBOUND is a
    // non-credential sentinel; /start explicitly refuses it until QR login.
    await saveLocal('secrets.json', { WEIXIN_ADMIN_TOKEN: adminToken, WEIXIN_BOT_TOKEN: 'UNBOUND' });
    console.log('已生成本地管理凭证（0600，未输出 token）。部署时使用 --secrets-file .local/secrets.json。');
    return;
  }
  if (action === 'url') {
    if (!arg) throw new Error('missing_worker_url');
    const config = await loadLocal<ClientConfig>('client.json');
    await saveLocal('client.json', { ...config, origin: workerOrigin(arg) });
    console.log('Worker 地址已保存。'); return;
  }
  if (action === 'bind') {
    const binding = await loadLocal<Record<string, unknown>>('binding.json');
    if (arg && arg !== '--discard-pending') throw new Error('unknown_bind_flag');
    console.log(JSON.stringify(await admin('bind', {
      ...binding, ...(arg === '--discard-pending' ? { discardPending: true } : {}),
    }), null, 2)); return;
  }
  if (['status', 'start', 'pause'].includes(action)) {
    console.log(JSON.stringify(await admin(action), null, 2)); return;
  }
  throw new Error('usage: npm run session -- init [URL] | url URL | bind | status | start | pause');
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'session_failed'); process.exitCode = 1; });
