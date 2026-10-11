# Agent 相册与语音：阶段结论（2026-10-11）

分支 `feat/cloudflare-migration`。**结论：隔离环境的功能验收通过；生产未切换。**

本文只记已在**真实微信 + 真实云端**验证过的结论，以及明确标注为未验证的部分。历史评估文档仍然有效：
`AGENT_V1.md`（契约）、`AGENT_MEDIA_VOICE_PLAN.md`（方案与实测结构）、`AGENT_USABILITY.md`（缺陷清单）。

## 1. 能力状态

| 能力 | 状态 | 验证方式 |
| --- | --- | --- |
| 相册只读查询（`list_media_items` / `get_album_summary`） | ✅ 通过 | 隔离 Worker + 真实 D1，逐项比对 |
| 语音理解（微信自带转写，**不使用 ASR**） | ✅ 通过 | 真实语音，转写原文回显比对 |
| 语音 → 成长记录写入 | ✅ 通过 | 真实语音 → 业务行 + 回执 id 一致 |
| 照片 → 存进相册 | ✅ 通过 | 真实照片；用户确认相册可打开 |
| AES-128-ECB 图片解密 | ✅ 通过 | FIPS-197 向量 + 对照 `node:crypto` 差分测试 |
| 服务端 intake（幂等 / 越权 / 签名校验） | ✅ 通过 | 端到端脚本，见 §3 |
| 真实微信 **24h 稳定性** | ⏳ 未做 | 需等窗口到期，只读取样 |
| 重复投递的可见行为 | ⚠️ 已知缺陷 | 已复现并有测试，未改 |
| 生产切换 | ❌ 未做 | 见 §5 |

## 2. 证据链

**相册只读查询**：`get_album_summary` 返回 total/images/videos/months，与 D1 逐项一致；`list_media_items` 字段恰为 `date/mediaType/format/title`；越界 `limit` 与多余参数返回 400。**永不返回媒体链接**（测试断言回复不含 `/api/media` 与 `http`）。

**语音理解**：用户发“今天小好体重，6.5kg”，回复首行 `（语音转写）今天小好体重，6.5kg` 与其原话一致 → 证明 `voice_item.text` 是微信自带转写，因此**下载、AES 解密、AMR/Silk 兼容、OpenRouter ASR 与音频出境全部不需要**。

**语音写入**：用户发“今天体重 8.5kg”，收到 `（语音转写）…已记录…体重 8.5 kg。记录 ID：8937dda7-…`；服务端核对业务行 `weight=8.5`、`date=2026-10-11`，回执 `operationKey=op_0`、`data.id` 与业务行 id 一致。

**照片归档**：用户发真实照片，回复“照片已存进相册。”；服务端记录 `IMAGE/jpg`，url 位于 `/api/media/uploads/wx/<身份命名空间>/`；回读对象 `200`、**498,955 字节**、容器 `jpeg`、`cache-control: private, no-store`；**用户确认相册里能正常打开**。

**解密算法**：照官方客户端 `src/cdn/pic-decrypt.ts` + `src/cdn/aes-ecb.ts`——**AES-128-ECB、无 IV、PKCS7**，`aes_key` 有 base64→16 字节与 base64→32 个 hex 字符两种编码。密钥/IV/模式三处若按经验猜测都会写错，而错误的症状是“存得进去、打开是坏图、且不报错”。

## 3. 可复现的验证命令

```sh
npx tsx scripts/verify-media-intake.ts                    # 服务端 intake 全矩阵（需 MYBABY_VERIFY_PASSWORD）
npx tsx scripts/weixin-bridge-deploy.ts                   # agent 模式：build+deploy+断言实际绑定
npx tsx scripts/weixin-bridge-deploy.ts --restore         # 回到 stage-A 桥接（关集成）
cd weixin && npm run session -- status                    # 只读运行状态
```

`verify-media-intake.ts` 先核对**实际部署的绑定**，再跑：建档 201 → 重放同 id → 未授权 403 → 无令牌 401 → 伪造图片 415 → 不支持类型 415 → 家庭会话回读 200 → 匿名读 401 → 清理测试记录与回执。**它第一次实跑就抓到了并发部署清空授权的问题**，因此能区分“授权被清”与“代码缺陷”。

## 4. 失败记录（含我方责任）

| 次 | 现象 | 真实原因 | 处置 |
| --- | --- | --- | --- |
| 1 | 语音只查询、不写入 | 我加的“新增前先查当天”提示词让模型只输出查询 | 改为“陈述测量必须规划新增，查询只能作为同一次规划里的附加调用”，并加测试断言 |
| 2 | 语音无任何回复 | **部署操作错**：`cf deploy --prebuilt` 复用了未导出集成环境变量时构建的产物，所有开关回落默认值 | 已由 `weixin-bridge-deploy.ts` 控制：同进程设定变量 + 断言实际绑定 |
| 3 | 同上 | 同一坑重犯 | 同上 |

**第 2 次我给出了错误归因**（归因于重复投递静默去重）。该行为确实存在且已复现，但不是那次的原因——当时我在核对实际部署绑定之前就下了结论。正确顺序是：先核对环境与绑定，再解释行为。

**另一处漏测**：语音分支此前从未被任何测试覆盖（脚手架未设 `MEDIA_INGEST_ENABLED`），现存 4 个测试（有转写 / 无转写 / 计数不变量 / 重复投递）。

**已修的真实缺陷**：归档成功的图片被同时计为 `rejected.image_message` 与 `accepted`，导致 `accepted + rejected > received`（实测多出正好 1）。现已保证每条消息只计一次，并有断言。

## 5. 当前隔离环境配置与回滚

线上 `mybaby-weixin` 处于 **agent 模式**，指向隔离测试 Worker：

```text
AGENT_MODE=agent · AGENT_WRITES_ENABLED=true · MEDIA_INGEST_ENABLED=true
MEDIA_PROBE_ENABLED=true · MYBABY_API_ORIGIN=<隔离测试 Worker>
```

- 写入目标是**隔离 D1**（当前为 E2E 播种状态，故宝宝名显示为测试名）。
- **未修改**：Vercel 生产、Neon 生产数据、正式域名、生产 R2、`.env` 以外的生产配置。
- **回滚**：`npx tsx scripts/weixin-bridge-deploy.ts --restore`（回到 stage-A 纯文字桥接），或直接回滚 Worker 版本到 `f91bd40f`。改配置后必须 pause → 等待 → start，否则 DO 仍运行旧代码（已实测）。
- 媒体对象存于隔离测试 bucket；验证遗留的 68 字节孤儿对象待维护窗口孤儿清理。

## 6. 遗留项（明确未完成）

1. **重复投递静默无回复**：同一 `message_id` 再次投递时，事件主键冲突被 `INSERT OR IGNORE` 丢弃、已存事件为 `done`、队列不再取，因此**计数在动但用户收不到任何回复**。是否补一句“这条我已处理过”属产品取舍，未改。
2. **真实微信 24h 稳定性复核**未做（需窗口到期，只读取样）。
3. **grant 会被共享测试 Worker 的并发部署清空**：环境固有问题，测试前需核对。
4. 图片归档的**维护期孤儿清理**未在冻结窗口执行。
5. **生产切换与生产验收未做**：本文所有结论仅限隔离环境。

## 7. 视频/图片封面不显示的根因与修法（交由媒体侧处理）

**现象**：相册里视频卡片没有封面（空白）；图片卡片看似正常但也不是真实照片。

**根因（已实测，非推测）**：

| 测试 | 结果 |
| --- | --- |
| `next/image` optimizer 取 `/api/media/...`（匿名） | `400 Invalid image optimization parameters` |
| `next/image` optimizer 取同一路径（带家庭会话） | 同样 `400` |
| **直接**取同一路径（带家庭会话） | **`200`，`image/jpeg`** |
| 直接取（匿名） | `401`（私有路径，符合设计） |
| 视频 `thumbnailUrl` 非空比例 | **50/50** |
| 封面对象内容 | 7–10KB 合法 JPEG |

私有媒体必须由**浏览器带家庭 Cookie 直取**。`next/image` 会把它交给优化器，而优化器直接拒收（`400`），因此三处媒体渲染全部落入 `onError`：

- 图片卡片：`onError` 显示占位图 → 看似“没事”，实际不是真实照片
- 视频卡片：`onError` 执行 `display='none'` → **彻底空白**，且只留一条 console 错误——最难发现的失败模式

**修法（`src/app/components/PhotoGallery.tsx`）**：

1. 三处私有媒体渲染（弹窗图片、列表图片、视频封面）从 `next/image` 改为原生 `<img>`，浏览器即带 Cookie 直取；移除因此不再使用的 `next/image` import。
2. 视频封面的 `onError` 改为**回落可见占位图**，而不再隐藏元素：

```tsx
onError={(e) => { e.currentTarget.src = '/placeholder-video-thumb.svg'; }}
```

3. `public/placeholder-video-thumb.svg` 已存在且线上可访（`200`），可直接作为回落。

**为何本仓未提交该修复**：同文件当时还包含媒体侧未提交的改动（弹窗 `<video>` 换为新组件），而该改动 import 了未跟踪的 `src/app/components/PrivateVideo.tsx`。单独提交这个文件会让干净检出的构建失败；一起提交则会把未完成的实现归到他人名下。可直接取用的修复版本在工作区 `.migration/rc/PhotoGallery.fixed.tsx`（0600，私有）。

**验证标准**：重新部署后，列表卡片显示**真实照片/视频封面**（不是占位图），且视频卡片在回落路径下不会出现空白。
