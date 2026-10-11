import {bindings,defineConfig,exports,triggers} from 'cf/config';
import * as entrypoint from './src/index.ts' with {type:'cf-worker'};
const name='mybaby-weixin-acceptance';
const origin=process.env.MYBABY_ACCEPTANCE_ORIGIN;
if(!origin||new URL(origin).hostname.split('.')[0]!=='mybaby-web-migration-test')throw new Error('isolated_web_origin_required');
export default defineConfig({worker:{name,entrypoint,workersDev:true,compatibilityDate:'2026-10-11',compatibilityFlags:['nodejs_compat'],
 env:{WEIXIN_SESSION:bindings.durableObject({worker:name,exportName:'WeixinSession'}),
 ILINK_ACCEPTANCE:bindings.durableObject({worker:name,exportName:'SyntheticILink'}),
 INBOX:bindings.queue({name:'mybaby-acceptance-inbox'}),WEIXIN_ADMIN_TOKEN:bindings.secret(),WEIXIN_BOT_TOKEN:bindings.secret(),
 OPENROUTER_API_KEY:bindings.secret(),MYBABY_AGENT_TOKEN:bindings.secret(),
 OPENROUTER_MODEL:bindings.text('meta/muse-spark-1.3-contributor'),DEPLOYMENT_KIND:bindings.text('synthetic-acceptance'),
 AGENT_MODE:bindings.text('agent'),AGENT_WRITES_ENABLED:bindings.text('true'),AGENT_TIME_ZONE:bindings.text('Asia/Shanghai'),
 REAL_MYBABY_API:bindings.worker({worker:'mybaby-web-migration-test'}),REAL_MYBABY_ORIGIN:bindings.text(origin),MYBABY_API_ORIGIN:bindings.text(process.env.MYBABY_ACCEPTANCE_BRIDGE_ORIGIN||''),
 },exports:{WeixinSession:exports.durableObject({storage:'sqlite'}),SyntheticILink:exports.durableObject({storage:'sqlite'})},
 triggers:[triggers.queue({name:'mybaby-acceptance-inbox',deadLetterQueue:'mybaby-acceptance-inbox-dlq',maxBatchSize:1,maxBatchTimeout:1,maxConcurrency:1,maxRetries:5,retryDelay:30})],observability:{enabled:true}}});
