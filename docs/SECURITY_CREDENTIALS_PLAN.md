> 极简模式（2026-10-11 更新）：就你和老婆两人低频用，下面的重方案都不用做。保留现状即可：内存限流够用、单套 R2 长期凭证、私有桶、7天会话。换密码即全员下线。
> 需要做的只有 3 件小事：① 生产 R2 换成长期凭证（去掉 7 天 SESSION_TOKEN）；② 公共 r2.dev 保持关闭；③ 偶尔手动清一次传了一半的孤儿文件。详见 §0。

## 0. 极简做法（两人用，直接照做）

- 不用 WAF、不用分布式限流：现在内存限流防手误够了，被刷的概率几乎为零。
- 不用双 key、不用吊销表：想下线所有设备直接换密码或 secret，7 天会话到期自动失效。
- 不用 Cron：孤儿文件几个月手动看一次 R2 `uploads/`，按时间排，删掉没有在相册里的就行。
- 保留 presign 600s 不用改，弱网上传更省心。
- 下面 §2 之后的都是重方案存档，不用看、不用做。

> 目标：补齐 `docs/CLOUDFLARE_MIGRATION.md` 和 `docs/AGENT_V1.md` 里明确标注的阻塞项。不改主会话正在动的代码，只给可执行步骤。
> 现状基线：2026-10-11，分支 `feat/cloudflare-migration`。

## 1. 现状审计（只读代码结论）

| 项 | 现状 | 风险 |
|---|---|---|
| 登录限流 `src/lib/auth.ts:loginAllowed` | 内存 Map：单 IP 5次/15min，全局 30次/min，`>5000` key 时清理 | Worker 多 isolate 各自计数，可被轮换 IP / 并发实例绕过。注释自己写了“不是分布式保证” |
| 会话 `createSession/validSession` | HMAC(password+secret)，payload `{v,exp,nonce}`，7天，HttpOnly+SameSite Strict+prod Secure | 无服务端吊销；logout 只清浏览器 Cookie，被盗 Cookie 到期前有效；换密码/secret 全量失效，无灰度 |
| CSRF `proxy.ts + sameOrigin` | 非 GET/HEAD/OPTIONS 校验 Origin；login/logout 也校验 | 依赖 Origin 头，GET 接口靠 Cookie+`private,no-store`，无 WAF 兜底（极简模式已接受） |
| R2 签名 `photos/generate-upload-url` | 服务端 S3 presign 600s，ContentType 白名单 7 种，size 上限 1GiB，key `uploads/<uuid>.<ext>`，视频另签 thumb | `ContentLength` 只进 presign 参数，R2/S3 不强制；无服务端完成回调校验；孤儿对象无回收 |
| R2 凭证 `cloudflare.config.ts` | `R2_ACCESS_KEY_ID/SECRET/SESSION_TOKEN` 全是 secret；测试用 7 天临时凭证 | 正式不能用带 SessionToken 的临时凭证；迁移用（读源+写测试）与运行时（仅 presign）混用同一套 |
| 私有读 `/api/media/[...key]` | Cookie 鉴权 + Range + `private,no-store` + 非图片视频强制 attachment | 旧生产 R2 公共链接仍存在，关了页面也绕不过（AGENT_V1 已声明） |

## 2. 方案总览

1. ~~WAF/限流移到边缘~~（极简模式不做），应用内限流保留为单实例兜底。
2. R2 凭证拆三套 + 轮换手册，生产去 SessionToken。
3. 签名直传收紧（有效期、大小、类型二次校验）+ 孤儿回收 Cron。
4. 会话加固（双 key 灰度 + 服务端吊销表）。
5. 日志/告警只存 hash，不存密码和完整 IP。

## 3. WAF + 分布式限流（存档，极简模式不做）

测试 Worker 无正式域名，先在测试域名上验证规则语法，正式域名切流前再绑一次。

建议规则（Cloudflare Dashboard → Security → WAF / Rate limiting rules）：

- `POST /api/auth/login`：同一 IP 5 分钟 5 次 → block 15 分钟；同一 ASN/全球 1 分钟 100 次 → managed challenge。
- `POST /api/photos/generate-upload-url`：已登录会话 1 分钟 20 次 → 429（防签名 URL 刷）。
- `POST /api/agent/v1`：按 Token 指纹 1 分钟 60 次 → 429；无 Token 直接 block（省源站）。
- `GET /api/media/*`：1 分钟 300 次/IP → challenge（防 Range 拖带宽）。

`cf` 参考（先 `cf cli search "rate limiting"` 拿准确参数，不要硬背）：

```sh
cf cli search "create rate limiting rule"
cf cli search "create WAF custom rule"
```

应用内 `loginAllowed` 保留，但阈值收紧为文档注释“单实例兜底”，不要宣称全局生效。正式验收：用两个出口 IP 并发 10 次错误密码，期望 429 且 Worker 日志无穿透。

## 4. R2 长期凭证（拆三套）

| 用途 | 权限 | 有效期 | 存哪 |
|---|---|---|---|
| `runtime-presign` | 仅正式 bucket `uploads/*` 的 PutObject + Get（给 presign 用），无 Delete、无 List | 长期，可 90 天轮换 | Worker secret `R2_ACCESS_KEY_ID/SECRET`，**不设 SESSION_TOKEN** |
| `migration-copy` | 源 bucket 只读 Get + 测试 bucket 写 | 一次性，迁移完即删 | `.migration/secrets.json`（0600），不进 Worker |
| `media-reader` | 正式 bucket Get（给 `/api/media` 服务端用，若改走 R2 binding 则可省） | 长期 | Worker secret 或直接 R2 binding（推荐 binding，零 AK） |

轮换手册：

1. 新建第二套 AK → 双写进 Worker secrets（`R2_ACCESS_KEY_ID_2`），部署。
2. 代码优先读新、失败回退旧（灰度 24h）。
3. 删除旧 AK，确认 `test:cloudflare` 的签名直传 + Range 206 仍过。
4. 测试 bucket 凭证与正式完全隔离；`target.json` guard 保持“只允许测试资源名”，正式资源需另行批准（沿用迁移手册第 8 节）。

CORS：只允许正式 origin `PUT` 到 `uploads/*`，`MaxAge 600`，不要 `*`。公共 `r2.dev` 保持 disabled（已验证，切换后复查一次）。

## 5. 签名直传收紧 + 孤儿回收

- presign `expiresIn` 从 600s → 120s（移动端弱网可放 300s，不要更大）。
- `generate-upload-url` 返回时往 D1 写 `media_upload_receipts(id, payloadHash, expiresAt)`（已复用 `media-upload.ts` 的 receipt 思想，只是提前占位）。
- 客户端完成 PUT 后必须调 `POST /api/photos/complete`（新接口，主会话排期时再加），服务端 HEAD R2 校验 `size + contentType`，不符则删对象 + 409。
- Cron 回收（Worker `scheduled`，每天一次）：列 `uploads/*`，`createdAt < now-24h` 且 D1 无 `media_items` 引用 → Delete。先 dry-run 打日志两周，再开真删。费用：R2 List + Delete 都是 Class B，比留着 Class A 读便宜一个量级。

验收：上传后不调 complete，24h 后对象消失；调 complete 但改了 ContentType，期望 415 + 对象被删。

## 6. 会话加固（小改动，大收益）

1. Cookie 名加 `__Host-` 前缀（需 Secure+Path=/+无 Domain），防子域覆盖。
2. secret 双 key：`MYBABY_SESSION_SECRET` + `MYBABY_SESSION_SECRET_PREV`，验签时新旧都试，签发只用新。轮换时旧 key 保留 7 天 = 零下线轮换。
3. D1 加 `revoked_sessions(nonce, revokedAt)`，logout 时写一行，`validSession` 改走 `DB.withSession` 查一次（读多写少，可缓存 5min）。强制下线 =  bump `v:1→2`。
4. TTL 保持 7 天，但加“密码变更即全失效”（现状已是，保留并写进用户文档）。

## 7. 日志隐私与告警

- 日志只存 `sha256(ip+/24)` 和 `sha256(token指纹)`，不存密码、完整 Cookie、R2 Secret。
- 告警阈值：`401/429 突增 5x`、`generate-upload-url 4xx >10%/5min`、`media 404 >20%/5min` → 通知。DLQ/Queue 告警沿用微信侧的即可。
- 旧公共 R2 链接：切私有后不要立刻删，先 `Cache-Control: no-store` + 换 key 前缀，观察 30 天无外链再清缓存（AGENT_V1 已警告“密码保护不了已公开文件”）。

## 8. 正式切换前检查单

> 极简模式（见开头与 §0）下第 1、3、4 条的加固项不做；下面保留原重方案清单作为存档。

- [ ] ~~WAF 4 条规则在测试域名压测通过，正式域名已复制~~（极简模式不做）
- [ ] 生产 R2 三套凭证就位，无 SESSION_TOKEN，CORS 无 `*`
- [ ] presign 120s + complete 校验 + Cron dry-run 两周
- [ ] 会话双 key + 吊销表 + `__Host-` 上线，旧 Cookie 平滑过期
- [ ] `npm run test:cloudflare` 全过 + 手动家庭设备（Safari/Chrome）登录/上传/Range 播放
- [ ] 旧公共链接处置方案已批准（保留/换前缀/清缓存三选一）

主会话如果正在改 `auth.ts / proxy.ts / generate-upload-url`，本方案只合 `docs/`，不碰那三个文件，避免冲突。
