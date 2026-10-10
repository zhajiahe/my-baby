import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import qrcode from 'qrcode-terminal';
import { API_BASE, ilinkRequest, trustedBaseUrl, ILinkError } from '../src/weixin.js';
import { loadLocal, saveLocal } from './local.js';

async function main(): Promise<void> {
  // Ensure local admin setup exists before beginning a login that issues a credential.
  const secrets = await loadLocal<Record<string, string>>('secrets.json');
  const deadline = Date.now() + 8 * 60_000;
  let base = API_BASE, qr = '', verifyCode: string | undefined;
  let refreshes = 0;
  const input = createInterface({ input: stdin, output: stdout });
  try {
    while (Date.now() < deadline) {
      if (!qr) {
        if (++refreshes > 3) throw new Error('qrcode_refresh_limit');
        const result = await ilinkRequest(API_BASE, 'ilink/bot/get_bot_qrcode?bot_type=3', {
          body: { local_token_list: [] },
        });
        if (typeof result.qrcode !== 'string' || typeof result.qrcode_img_content !== 'string') throw new Error('invalid_qrcode');
        qr = result.qrcode; base = API_BASE; verifyCode = undefined;
        console.log('请用微信扫描下面的二维码（二维码也是临时授权信息，请勿分享）：');
        qrcode.generate(result.qrcode_img_content, { small: true });
        // Deliberately don't print the raw URL to logs.
      }
      let status: Record<string, unknown>;
      try {
        const params = new URLSearchParams({ qrcode: qr });
        if (verifyCode) params.set('verify_code', verifyCode);
        status = await ilinkRequest(base, `ilink/bot/get_qrcode_status?${params}`, { timeoutMs: 35_000 });
      } catch (error) {
        if (error instanceof ILinkError && error.retryable) {
          await new Promise(resolve => setTimeout(resolve, 2_000)); continue;
        }
        throw error;
      }
      switch (status.status) {
        case 'confirmed': {
          if (typeof status.bot_token !== 'string' || !status.bot_token
            || typeof status.ilink_bot_id !== 'string' || !status.ilink_bot_id
            || typeof status.ilink_user_id !== 'string' || !status.ilink_user_id) throw new Error('incomplete_login_credentials');
          const apiBaseUrl = trustedBaseUrl(typeof status.baseurl === 'string' ? status.baseurl : base);
          await saveLocal('secrets.json', { ...secrets, WEIXIN_BOT_TOKEN: status.bot_token });
          await saveLocal('binding.json', { botId: status.ilink_bot_id, apiBaseUrl, allowedUserIds: [status.ilink_user_id] });
          console.log('扫码成功。凭证已保存到 .local/（0600），未输出 token 或用户 ID。');
          console.log('下一步：暂停已有会话 → cf deploy --prebuilt --secrets-file .local/secrets.json → session bind → session start。');
          return;
        }
        case 'need_verifycode':
          verifyCode = (await input.question('请输入手机微信显示的验证码：')).trim(); break;
        case 'scaned': verifyCode = undefined; break;
        case 'expired': qr = ''; console.log('二维码过期，重新获取。'); break;
        case 'verify_code_blocked': throw new Error('verify_code_blocked_restart_later');
        case 'scaned_but_redirect':
          if (typeof status.redirect_host !== 'string') throw new Error('missing_redirect_host');
          base = trustedBaseUrl(`https://${status.redirect_host}`); break;
        case 'binded_redirect': throw new Error('already_bound_no_new_credentials_reuse_existing_or_rebind');
        case 'wait': break;
        default: throw new Error('unknown_login_status');
      }
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
    throw new Error('login_timeout');
  } finally { input.close(); }
}
main().catch(error => {
  // No raw transport exception or response body: it may contain a token/QR URL.
  console.error(error instanceof ILinkError ? error.category : error instanceof Error ? error.message : 'login_failed');
  process.exitCode = 1;
});
