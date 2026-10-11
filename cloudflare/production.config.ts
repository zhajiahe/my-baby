import {bindings,defineWorker} from 'cf/config';
// Reviewed standby template only: it is NOT selected by the existing test deploy
// command. Provision independent resources and obtain explicit approval before use.
export function productionWorker(){
 const id=process.env.MYBABY_PRODUCTION_D1_ID,account=process.env.MYBABY_PRODUCTION_ACCOUNT_ID,version=process.env.MYBABY_CODE_VERSION;
 if(!id||!account||!version||id===process.env.MYBABY_D1_TEST_ID)throw new Error('independent_production_resource_metadata_required');
 if(process.env.MYBABY_PRODUCTION_APPROVED!=='standby-only')throw new Error('explicit_standby_approval_required');
 return defineWorker({name:'mybaby-web-production',entrypoint:'vinext/server/fetch-handler',workersDev:false,
  compatibilityDate:'2026-10-11',compatibilityFlags:['nodejs_compat'],assets:{notFoundHandling:'none'},observability:{enabled:true},
  env:{ASSETS:bindings.assets(),DB:bindings.d1({name:'mybaby-production',id}),MEDIA:bindings.r2({name:'mybaby-production-media'}),
   MYBABY_APP_PASSWORD:bindings.secret(),MYBABY_SESSION_SECRET:bindings.secret(),MYBABY_AGENT_TOKEN:bindings.secret(),MYBABY_UPLOAD_SECRET:bindings.secret(),MYBABY_OPERATIONS_TOKEN:bindings.secret(),
   R2_ACCESS_KEY_ID:bindings.secret(),R2_SECRET_ACCESS_KEY:bindings.secret(),
   // Long-lived bucket-scoped credentials, no temporary SESSION_TOKEN. Do not
   // issue/upload credentials until the separate production bucket exists.
   R2_ACCOUNT_ID:bindings.text(account),R2_BUCKET_NAME:bindings.text('mybaby-production-media'),
   MYBABY_AGENT_GRANTS:bindings.text('[]'),MYBABY_AGENT_WRITES_ENABLED:bindings.text('false'),
   MYBABY_DEPLOYMENT:bindings.text('production-standby'),MYBABY_WRITES_FROZEN:bindings.text('true'),MYBABY_CODE_VERSION:bindings.text(version),
  }});
}
