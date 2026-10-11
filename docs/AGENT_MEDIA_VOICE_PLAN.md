# 图片自动存档 + 语音转文字方案（微信 Agent）

> 模型：ASR 用 `qwen/qwen3-asr-0.6b`（OpenRouter `/audio/transcriptions`）。图片先只存档不做 AI 看图。

## 1. 为什么现在不行

- `weixin/src/weixin.ts` 只认 `type=1` 文本，其余判 `non_text_message` 丢弃。官方协议里图片是 `type=2`、语音是 `type=3`，带 CDN 引用 + AES key（`ImageItem{media/thumb_media/aeskey}`），不是直链。
- 微信语音编码大概率是 AMR/Silk，不是 wav/mp3，直接扔给 ASR 可能拒收，Worker 里又没有 FFmpeg 可转。
- `weixin` Worker 现在没有 R2 binding，Agent 也没有“建媒体记录”工具，图片即使下载下来也没地方落。

## 2. 先做一个取样 Spike（必须，否则后面全是猜）

找个时间你和老婆各发 1 张照片 + 1 条 5 秒语音，然后看 DO 里 `reception.rejected` 的 `non_text_message` 计数涨没涨。接着临时加一行脱敏日志（只打 `type` 和字段名，不打正文/key），拿到真实结构：

- IMAGE：`image_item` 里是 `url` 直链还是 `media{...}+aeskey`？`thumb_media` 有没有？
- VOICE：`voice_item` 的时长字段名、大小、格式名是什么？

可参考官方 `src/api/types.ts` 的 `MessageItemType{IMAGE:2,VOICE:3}` 和 `ImageItem` 定义。解密逻辑抄官方客户端的 AES-128 部分，不要自己造。

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
