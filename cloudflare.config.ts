import { bindings, defineConfig, defineWorker } from 'cf/config';
// Test-only deployment. No production routes, domains, Queues or Weixin bindings.
export default defineConfig({ worker: defineWorker({
 name:'mybaby-web-migration-test',entrypoint:'vinext/server/fetch-handler',
 compatibilityDate:'2026-10-11',compatibilityFlags:['nodejs_compat'],assets:{notFoundHandling:'none'},
 env:{ASSETS:bindings.assets(),DB:bindings.d1({name:'mybaby-cloudflare-migration-test',id:process.env.MYBABY_D1_TEST_ID}),
 MEDIA:bindings.r2({name:'mybaby-cloudflare-migration-test-media'}),
 ...(process.env.MYBABY_SOURCE_BUCKET?{SOURCE_MEDIA:bindings.r2({name:process.env.MYBABY_SOURCE_BUCKET})}:{}),
 MYBABY_APP_PASSWORD:bindings.secret(),MYBABY_SESSION_SECRET:bindings.secret(),MYBABY_AGENT_TOKEN:bindings.secret(),
 MIGRATION_TOKEN:bindings.secret(),MYBABY_UPLOAD_SECRET:bindings.secret(),MYBABY_OPERATIONS_TOKEN:bindings.secret(),
 R2_ACCESS_KEY_ID:bindings.secret(),R2_SECRET_ACCESS_KEY:bindings.secret(),R2_SESSION_TOKEN:bindings.secret(),
 R2_ACCOUNT_ID:bindings.text(process.env.MYBABY_R2_ACCOUNT_ID||''),R2_BUCKET_NAME:bindings.text('mybaby-cloudflare-migration-test-media'),
 MYBABY_AGENT_GRANTS:bindings.text(process.env.MYBABY_TEST_AGENT_GRANTS||'[]'),MYBABY_AGENT_WRITES_ENABLED:bindings.text(process.env.MYBABY_TEST_AGENT_GRANTS?'true':'false'),MYBABY_DEPLOYMENT:bindings.text('migration-test'),MYBABY_WRITES_FROZEN:bindings.text(process.env.MYBABY_TEST_WRITES_FROZEN||'false'),MYBABY_CODE_VERSION:bindings.text(process.env.MYBABY_CODE_VERSION||'unversioned'),MYBABY_REHEARSAL_MARKER:bindings.text(process.env.MYBABY_TEST_REHEARSAL_MARKER||''),
 },
})});
