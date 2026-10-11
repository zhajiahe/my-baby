import{execFileSync}from'node:child_process';import{readFileSync,writeFileSync}from'node:fs';import{createHash}from'node:crypto';import{testTargetGuard}from'./test-target-guard.js';
const {target}=testTargetGuard(),secrets=JSON.parse(readFileSync('.migration/secrets.json','utf8'));const report:any={kind:'test-worker-config-version-rollback-and-data-preservation',startedAt:new Date().toISOString(),productionCutover:false};
const run=(args:string[])=>execFileSync('cf',args,{encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024});
async function health(){const r=await fetch(target.origin+'/api/ops/health',{headers:{authorization:`Bearer ${secrets.MYBABY_OPERATIONS_TOKEN}`},signal:AbortSignal.timeout(30000)});if(r.status!==200)throw new Error('ops_probe_failed');return r.json() as Promise<any>;}
function dataHash(){
 writeFileSync('.migration/rollback-query.json',JSON.stringify({batch:['deployment_guard','babies','growth_records','milestones','media_items','agent_operations','media_upload_receipts'].map(table=>({sql:`SELECT * FROM ${table} ORDER BY ${table==='deployment_guard'?'name':'id'}`}))}),{mode:0o600});
 const data=JSON.parse(run(['d1','query',target.databaseId,'--body','@.migration/rollback-query.json'])).map((r:any)=>r.results);
 if(data[0][0].value!=='mybaby-cloudflare-migration-test')throw new Error('rollback_data_guard');
 return{sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex'),counts:data.slice(1).map((r:any)=>r.length)};
}
function deploy(marker:string){try{const log=execFileSync('npx',['tsx','scripts/cloudflare-test-deploy.ts','--without-source-media','--freeze-writes'],{env:{...process.env,MYBABY_TEST_REHEARSAL_MARKER:marker},encoding:'utf8',timeout:240000,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024});writeFileSync(`.migration/rollback-deploy-${marker}.log`,log,{mode:0o600});}catch{throw new Error('rehearsal_deploy_failed');}}
async function waitMarker(marker:string){
 for(let attempt=0;attempt<30;attempt++){
  const value=await health().catch(()=>null);
  if(value?.writesFrozen&&value.rehearsalMarker===marker)return;
  await new Promise(resolve=>setTimeout(resolve,2000));
 }
 throw new Error('frozen_marker_not_verified');
}
try{
 deploy('A');const a=testTargetGuard();await waitMarker('A');
 const deny=await fetch(target.origin+'/api/agent/v1',{method:'POST',headers:{authorization:`Bearer ${secrets.MYBABY_AGENT_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({})});
 if(deny.status!==503)throw new Error('agent_freeze_not_verified');
 report.before=dataHash();report.versionA=a.versionId;
 deploy('B');const b=testTargetGuard();report.versionB=b.versionId;await waitMarker('B');
 run(['workers','deployments','create','--worker',target.workerName,'--strategy','percentage','--versions',JSON.stringify([{version_id:a.versionId,percentage:100}])]);
 let verified=false;const began=Date.now();
 for(let attempt=0;attempt<30;attempt++){
  const restored=await health().catch(()=>null);if(restored?.writesFrozen&&restored.rehearsalMarker==='A'&&testTargetGuard().versionId===a.versionId){verified=true;break;}
  await new Promise(resolve=>setTimeout(resolve,2000));
 }
 report.rollbackObservedAfterMs=Date.now()-began;
 if(!verified)throw new Error('version_rollback_not_verified');
 report.after=dataHash();if(report.before.sha256!==report.after.sha256)throw new Error('rollback_lost_data');
 report.status='passed';console.log('PASS: isolated Worker A → B → A (same source, different config marker); freeze verified, D1 business rows and both receipt ledgers retained byte-for-byte. Not a production DNS/Vercel rollback rehearsal.');
}catch(error){report.status='failed';report.failure=error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:'private_error';process.exitCode=1;console.error('Rollback rehearsal failed:',report.failure);}
finally{report.finishedAt=new Date().toISOString();const data=JSON.stringify(report,null,2);writeFileSync(`.migration/rollback-rehearsal-${Date.now()}.json`,data,{mode:0o600});writeFileSync('.migration/rollback-rehearsal-report.json',data,{mode:0o600});}
