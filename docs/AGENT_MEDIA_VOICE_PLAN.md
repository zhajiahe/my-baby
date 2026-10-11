# 图片自动存档 + 语音转文字方案（微信 Agent）

> 模型：ASR 用 `qwen/qwen3-asr-0.6b`（OpenRouter `/audio/transcriptions`）。图片先只存档不做 AI 看图。

## 0. 实施状态（2026-10-11）

| 能力 | 状态 | 位置 / 阻塞 |
| --- | --- | --- |
| 相册只读查询（`list_media_items`、`get_album_summary`） | ✅ 已实现 + 真实云端验证 | `shared/agent.ts`、`src/lib/agent/*`；不返回私有链接 |
| 接收诊断细分（voice/image 分开计数） | ✅ 已实现 + **已实测确认媒体到达** | `weixin/src/weixin.ts`，结果见 §2.1 |
| 语音转写（ASR 客户端 + 管线） | ✅ 已实现（除下载外全链路） | `weixin/src/asr.ts`、`weixin/src/media.ts` |
| 语音下载 + AES 解密 | ❌ 未实现 | 需真实语音样本确认 `voice_item` 结构；现为 fail-closed stub |
| 语音接入 DO 事件流 | ❌ 未接入 | 下载可用前接入只会回“读不了语音” |
| 图片归档进相册 | ✅ **已实现 + 真实微信端到端验证（2026-10-11）** | 见 §0.1 |
| 真实微信端到端（图片） | ✅ 已完成（用户确认相册可打开） | 见 §0.1 |
| 语音→模型→真实写入 | ✅ **真实微信端到端验证（2026-10-11）** | 见 §0.2 |
| 真实微信端到端（语音→写入） | ✅ 已完成 | 见 §0.2 |

### 0.2 语音→写入验证证据（2026-10-11）

用户发语音“今天体重 8.5kg”，收到：

```text
（语音转写）今天体重8.5kg
已记录Synthetic E2E Edited 2026-10-11：体重 8.5 kg。记录 ID：8937dda7-…
```

即完整链路：真实语音 → 微信自带转写 → 标记回显 → 模型规划 `create_growth_record` → 隔离 D1 原子写入 + 回执 → 完成语。**未开启写入时不会静默假成功**，失败会回固定话术。

#### 前两次失败的原因（均为我方问题，不是设计缺陷）

| 次 | 现象 | 真实原因 |
| --- | --- | --- |
| 1 | 只查询、没写入 | 提示词「新增前先查当天」让模型只输出查询。已改为“陈述测量必须规划新增，查询只能作为同一次规划里的附加调用” |
| 2 | 无任何回复 | **部署操作错**：跑了 `cf deploy --prebuilt` 但未重建，而复用的 Build Output 是在未导出集成环境变量时构建的，于是所有开关回落为 `false`，语音分支第一行就返回 null |

**教训（已实施）**：`bindings.text()` 的值在构建时固化，集成开关必须在**同一进程内**对 build 与 deploy 同样设定；部署后必须核对**实际生效的绑定**，而不是核对意图。重复投递确实会静默去重（已复现并有测试），但那不是第 2 次的原因——当时未核对绑定就下了结论，已纠正。

### 0.1 图片归档验证证据（2026-10-11）

真实微信照片发送后：

- 桥接回复“照片已存进相册。”。
- 服务端记录：`media_items` 1 条，`IMAGE`/`jpg`，url 为 `/api/media/uploads/wx/<身份命名空间>/…`。
- 回读对象：`200`、**498,955 字节**、容器 `jpeg`、`content-type: image/jpeg`、`cache-control: private, no-store`。
- 用户确认**相册里能正常打开**。
- 服务端矩阵（隔离目标 `0b943825`）：建档 `201` → 重放同 id `200` → 未授权 `403` → 无令牌 `401` → 伪造图片内容 `415` → 不支持类型 `415` → 家庭会话回读 `200` → 匿名读 `401` → 测试记录与回执已清理。
- 已核对：对象尾部为 `82 d8` 而非 JPEG 标准的 `FF D9`。这**不是截断**：PKCS7 校验通过后，明文长度是精确值；且错误密钥几乎必然 padding 校验失败，不可能同时得到合法 JPEG 头与 487KB 合理体量。画面正常渲染也与此一致。
- 解密实现依据：官方客户端 `src/cdn/pic-decrypt.ts` + `src/cdn/aes-ecb.ts`（**AES-128-ECB、无 IV、PKCS7**，密钥有 base64→16 字节与 base64→hex 两种编码），并用 FIPS-197 向量与 `node:crypto` 差分测试证明。

**为什么停在这里**：再往后的每一步都必须先知道真实 payload 结构。猜错的后果是静默丢弃或错误解析，比明确报错更糟。所以未实现的部分统一 fail-closed，并给出家人能懂的话术。

## 1. 为什么现在不行

- `weixin/src/weixin.ts` 只认 `type=1` 文本。非文本消息现在会**按类型分开计数**（`voice_message`/`image_message`/`unsupported_media_type`/`unsupported_media_combination`），但仍然**不解析其内容**。官方协议里图片是 `type=2`、语音是 `type=3`，带 CDN 引用 + AES key（`ImageItem{media/thumb_media/aeskey}`），不是直链。
- 微信语音编码大概率是 AMR/Silk，不是 wav/mp3，直接扔给 ASR 可能拒收，Worker 里又没有 FFmpeg 可转。
- `weixin` Worker 现在没有 R2 binding，Agent 也没有“建媒体记录”工具，图片即使下载下来也没地方落。

## 2. 取样 Spike（分两步；第一步现在零风险可做）

### 2.1 第一步已完成（2026-10-11）：媒体确实到达 Bot

实测环境：桥接 `ce0c69f9`，`adapterVersion 0.1.4`（该标记用于自证线上 DO 实际在跑哪份代码），真实微信发送 1 条语音 + 1 张照片。

| 指标 | 值 |
| --- | --- |
| `received` | 18 → **20**（正好 2 条） |
| `accepted` | 15（未变：两条均未按文本接受） |
| `rejected.non_text_message` | **2**（部署前的历史值，**完全不再增长**） |
| `rejected.voice_message` | **1** |
| `rejected.image_message` | **1** |
| `failedCycles` / `lastError` | 0 / null |

结论：

- **语音与图片都真实到达 Bot**，且类型号与官方协议假设一致（图片 `type=2`、语音 `type=3`）。“服务端不下发媒体消息”这个风险排除，§3/§4 的方案成立。
- `non_text_message` 在部署后不再增长，反向证明新分类确实生效（新代码永远不会返回该原因）。
- **仍未确认**：`image_item`/`voice_item` 的内部结构（是直链还是 `media+aeskey`），见 2.2。

以后重测的判据：出现 `voice_message`/`image_message` → 到达；出现 `unsupported_media_type` → 类型号与协议假设不符，需改设计；`non_text_message` 增长 → 说明线上跑的仍是旧代码。

### 2.2 结构探针已实现（默认关闭，待部署后取样）

**为什么必须先知道结构**：媒体的 CDN 引用与 AES key **只出现在 `getupdates` 响应里**，之后不再有机会拿到。所以接入事件流前必须能从 payload 可靠抽出引用；否则只剩两个坏选择：丢掉照片，或把整个未验证 payload 持久化进 DO（存储膨胀 + 敏感数据落盘）。这是“先拿结构”是硬前置的真正原因。

`weixin/src/probe.ts` 已实现结构探针（有测试）：

- **只记录字段路径与值类型，绝不记录值**：如 `voice_item.media.aeskey:string`、`image_item.url:string(empty)`、`voice_item.duration:number`。
- 非标识符形状的 key 一律换成占位符，所以**值不可能通过 key 位置泄露**。
- 深度、路径数、数组采样数都有上限；同一形状重复上报不占名额，样本上限 3 条。
- 字符串只区分非空/空，不记长度或前缀。
- 测试断言密钥、CDN 域名、URL 参数、context_token、格式名、时长、字节数等具体值都不会出现在输出里。

启用：部署时设 `MEDIA_PROBE_ENABLED=true`，结果写入 DO 的 `reception.structure`，用 `cd weixin && npm run session -- status` 读取。**默认关闭时不改变任何行为。**

拿到结构后，剩下的是：把 `VoiceSource` 换成真实下载 + AES 解密（照官方客户端的 AES-128 实现，不自己造），并把媒体事件接入 DO 事件流。

### 2.2c 实测到的真实结构（2026-10-11，`adapterVersion 0.1.5` 探针）

真实微信发送 1 条语音 + 1 张照片，探针只记字段路径与类型。**下列内容不含任何值。**

每条 `item_list` 条目自带的字段：`type` · `msg_id:string` · `create_time_ms:number` · `update_time_ms:number` · `is_completed:boolean` · `button_item_list:array` · `at_bot_username_list:array`。

**语音 `voice_item`：**

```text
voice_item.media.full_url:string
voice_item.media.encrypt_query_param:string
voice_item.media.aes_key:string
voice_item.encode_type:number      # 推测为编码类型（需实测确认取值含义）
voice_item.bits_per_sample:number
voice_item.sample_rate:number
voice_item.playtime:number         # 时长，单位未确认（推测 ms）
voice_item.text:string             # 非空！
```

**图片 `image_item`：**

```text
image_item.aeskey:string
image_item.media.full_url:string
image_item.media.encrypt_query_param:string
image_item.media.aes_key:string
image_item.hd_size / mid_size / thumb_size / thumb_height / thumb_width :number
```

#### 结构带来的两个修正

1. **`voice_item.text` 就是微信自带的语音转文字（2026-10-11 已由用户验证）。** 用户发“今天小好体重，6.5kg”，收到的回复首行为 `（语音转写）今天小好体重，6.5kg`，与其原话一致。因此“下载 → AES 解密 → ASR”整条方案**对语音理解不再需要**：无 AMR/Silk 格式兼容问题、无音频出境、无额外费用。现在只把转写文本送进既有校验管线，并标记 `（语音转写）`。
   - 验证方式说明：探针只能证明字段非空，不能看内容（那正是探针不记值的设计）。唯一正确的验证就是让桥接直接用它回复、由用户在微信里判断，已执行。
   - `asr.ts`/`media.ts` 保留为 `text` 为空时的兜底。**仍未知**：`text` 在什么情况下为空（例如极短语音、特定语言、发送方客户端未转写），所以在拿到空样本前不删兜底。
2. **字段名与之前的推测不同**：不是 `media{aeskey}` 单一形式，而是 `media.full_url` + `media.encrypt_query_param` + `media.aes_key`；图片另外多一个顶层 `aeskey`。`duration` 实际叫 `playtime`。所以之前任何“照猜写”的下载实现都会错。

#### 仍然未知

- AES 解密的确切算法/模式（需照官方客户端的 AES-128 实现，不得自造）。
- `encrypt_query_param` vs `aes_key` 在请求时各自如何用。
- `encode_type` 的取值含义（直接影响格式白名单）。
- `text` 为空时是否存在，以及空时如何退（现已有“没有可用文字”固定回复，未实测触发）。
- 图片/语音的大小上限与是否需要缩略图单独下载。

#### 图片解密探测结果（2026-10-11，`adapterVersion 0.1.7`）

用户发 1 张照片，探针只记摘要：

```text
status: 200          # URL 可直接取得，不需额外签名头
contentType: ""      # 未提供 content-type
bytes: 187984        # ~184KB，与真实照片大小相符
signature: unknown   # 前几字节不匹配 JPEG/PNG/GIF/WEBP 任何容器头
host: qq.com         # weixin.qq.com 域名，已在白名单内
```

**结论：图片必须做 AES-128 解密，不能直接入库。** 字节数合理但无图像容器头，说明拿到的是密文。

为什么这个探测值得先做：如果照猜实现，会把 ~184KB 密文当作 JPEG 写入 `media_items`，**存得进去、打开是坏图，而且全程不报错**。这是最糟的失败模式，现已被挡住。

**下一步（唯一剩余的未知）**：AES-128 解密实现。必须照官方客户端的实现核对（密钥/IV 派生、分组模式、padding、`aes_key` 先 base64 解码等），**不自造**——猜错同样会得到“能存不能看”的结果。`image_item` 同时存在顶层 `aeskey` 与嵌套 `media.aes_key`，两者用途需从官方实现确认。

### 2.2b 原步骤（保留供参考）

临时加一行脱敏日志（只打 `type` 和字段名，不打正文/key），拿到真实结构：

- IMAGE：`image_item` 里是 `url` 直链还是 `media{...}+aeskey`？`thumb_media` 有没有？
- VOICE：`voice_item` 的时长字段名、大小、格式名是什么？

可参考官方 `src/api/types.ts` 的 `MessageItemType{IMAGE:2,VOICE:3}` 和 `ImageItem` 定义。解密逻辑抄官方客户端的 AES-128 部分，不要自己造。

### 2.3 已就绪、等结构确认即可接上的部分

- **语音**：`weixin/src/asr.ts`（转写客户端、限额、错误分类）+ `weixin/src/media.ts`（分类、可注入 `VoiceSource`、`（语音转写）`标记）已实现并有 mock 测试覆盖。剩下的是把 `VoiceSource` 换成真实下载+解密，并接进 DO 事件流。
- **相册**：只读查询已上线（`list_media_items`/`get_album_summary`，有真实云端证据）；图片归档的**写入侧契约尚未实现**。

## 3. 图片自动存档（Phase 1，只存不解读）

```
微信 IMAGE → Worker 下载(+解密) → R2 put uploads/wx-<messageId>.jpg
  → 调 Web 新接口 POST /api/agent/v1 operation=create_media_record（需加白名单+grants校验）
  → D1 media_items 落一条“来自微信”，相册即时可见
```

- weixin 的 `cloudflare.config.ts` 加 `MEDIA: bindings.r2(...)`（正式桶另批，测试先用迁移测试桶）。
- 大小卡 10MB，超了回一句“图太大请去网页传原图”。
- 视频/文件（type 4/5）先明确拒绝并提示，不进 R2，防带宽爆炸。
- 回复话术：`照片已存进相册（1张）。想记体重身高再发一句文字。`

## 4. 语音转文字（Phase 2，qwen3-asr-0.6b）

```
微信 VOICE → Worker 下载(+解密) → base64 → POST openrouter /api/v1/audio/transcriptions
  { model: "qwen/qwen3-asr-0.6b", audio: {data, format} } → 文本 → 走现有 planMessage 流程
```

- 先只接 <60 秒语音，超了回“太长了，分两条发”。
- 转写失败/格式不支持就回“没听清，转成文字发我吧”，不要静默丢。
- 转写文本必须和普通文字走同一套校验（单位、日期、斤→kg），并在回复里注明 `（语音转写）`，方便你发现误听。
- 费用：0.6B 小模型，两人用可忽略；注意 OpenRouter 按音频时长计费，别拿音乐/长语音刷。
- 若实测 AMR/Silk 被拒，备选：① 提示用户用微信自带转文字；② 另起一个 Node 小服务做转码（不在 Worker 里折腾 WASM FFmpeg）。

## 5. 最小改动清单（给主会话）

1. `weixin.ts`：加 `image_item/voice_item` 解析 + 拒绝原因细分（`image_too_large/voice_too_long`）。
2. `session.ts` events 表加 `kind(text/image/voice)+media_key` 列，图片语音走独立分支，不进 Agent 文本流水线。
3. Web 侧加 `create_media_record` 工具（白名单参数 date/key/caption），复用现有 receipt 幂等。
4. `formatResults` 加图片/语音两种回复模板。
5. 测试：各 1 张图 + 1 条语音的端到端（收→存→回）， recount `reception` 计数。

## 6. 不做的

- 不做 AI 看图写描述、不做视频存档、不做语音直接记体重（必须先转文字再过一遍校验）。
- 不要把宝宝原图原音频发给模型做训练式调用：ASR 只过语音，图片只进 R2，不进模型。
