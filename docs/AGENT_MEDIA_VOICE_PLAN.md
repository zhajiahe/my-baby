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
| 图片归档进相册 | ❌ 未实现 | 需真实图片样本 + weixin Worker 加 R2 binding |
| 真实微信端到端（语音/图片） | ❌ 未做 | 目前只有 HTTP 层验证 |

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

1. **`voice_item.text` 非空，很可能是微信自带的语音转文字。** 如果是，则“下载 → AES 解密 → ASR”整条方案可以不要：无需处理 AMR/Silk、无需音频出境、无额外费用。`asr.ts`/`media.ts` 仍作为 `text` 为空时的兜底保留。
   **未验证**：`text` 的内容确实不能通过探针验证（那正是探针不记值的原因）。唯一正确的验证是让桥接直接用它回复，由用户在微信里判断是否为自己的原话。
2. **字段名与之前的推测不同**：不是 `media{aeskey}` 单一形式，而是 `media.full_url` + `media.encrypt_query_param` + `media.aes_key`；图片另外多一个顶层 `aeskey`。`duration` 实际叫 `playtime`。所以之前任何“照猜写”的下载实现都会错。

#### 仍然未知

- AES 解密的确切算法/模式（需照官方客户端的 AES-128 实现，不得自造）。
- `encrypt_query_param` vs `aes_key` 在请求时各自如何用。
- `encode_type` 的取值含义（直接影响格式白名单）。
- `text` 为空时是否存在，以及空时如何退。
- 图片/语音的大小上限与是否需要缩略图单独下载。

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
