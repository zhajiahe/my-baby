import { bindings, defineConfig, exports, triggers } from 'cf/config';
import * as entrypoint from './src/index.ts' with { type: 'cf-worker' };

export default defineConfig({
  worker: {
    name: 'mybaby-weixin',
    compatibilityDate: '2026-10-06',
    entrypoint,
    workersDev: true,
    env: {
      WEIXIN_SESSION: bindings.durableObject({ worker: 'mybaby-weixin', exportName: 'WeixinSession' }),
      INBOX: bindings.queue({ name: 'mybaby-inbox' }),
      WEIXIN_ADMIN_TOKEN: bindings.secret(),
      WEIXIN_BOT_TOKEN: bindings.secret(),
      OPENROUTER_MODEL: bindings.text('meta/muse-spark-1.3-contributor'),
      // Remains bridge-only until phase A and business deployment are accepted.
      AGENT_MODE: bindings.text('bridge'),
      AGENT_WRITES_ENABLED: bindings.text('false'),
      AGENT_TIME_ZONE: bindings.text('Asia/Shanghai'),
      MYBABY_API_ORIGIN: bindings.text(''),
      OPENROUTER_API_KEY: bindings.secret(),
      MYBABY_AGENT_TOKEN: bindings.secret(),
    },
    exports: { WeixinSession: exports.durableObject({ storage: 'sqlite' }) },
    triggers: [triggers.queue({ name: 'mybaby-inbox', deadLetterQueue: 'mybaby-inbox-dlq',
      maxBatchSize: 1, maxBatchTimeout: 1, maxConcurrency: 1, maxRetries: 5, retryDelay: 30 })],
    observability: { enabled: true },
  },
});
