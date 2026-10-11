// Isolated regression: real D1 concurrency, response loss and authorization BEFORE replay.
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {testTargetGuard} from './test-target-guard.js';
const {target}=testTargetGuard(),secrets=JSON.parse(readFileSync('.migration/secrets.json','utf8'));
const body={source:'weixin',botId:'cloud-migration-test-bot',userId:'cloud-migration-test-user',messageId:crypto.randomUUID(),operation:'create_growth_record',operationKey:'op_0',args:{date:'2026-10-10',weight:10.6,notes:'synthetic-revocation'}};
const call=()=>fetch(target.origin+'/api/agent/v1',{method:'POST',headers:{authorization:`Bearer ${secrets.MYBABY_AGENT_TOKEN}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
const check=(ok:unknown,code:string)=>{if(!ok)throw new Error(code);};
const report:{status:string;checks:string[];finishedAt?:string}={status:'failed',checks:[]};
const deploy=(grants:boolean)=>{
 const output=execFileSync('npm',['run','deploy:cloudflare:test','--','--without-source-media',...(grants?['--synthetic-agent']:[])],{encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']});
 writeFileSync(`.migration/rc/agent-${grants?'grant':'revoke'}-deploy.log`,output,{mode:0o600});
};
const ledger=()=>{
 writeFileSync('.migration/rc/agent-query.json',JSON.stringify({batch:[{sql:"SELECT COUNT(*) AS receipts, COUNT(DISTINCT json_extract(result,'$.data.id')) AS mutations FROM agent_operations WHERE botId=? AND messageId=?",params:[body.botId,body.messageId]}]}),{mode:0o600});
 return JSON.parse(execFileSync('cf',['d1','query',target.databaseId,'--body','@.migration/rc/agent-query.json'],{encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']}))[0].results[0];
};
async function main(){
try{
 deploy(true);
 let ready=false;
 for(let i=0;i<20;i++){
  const res=await fetch(target.origin+'/api/agent/v1',{method:'POST',headers:{authorization:`Bearer ${secrets.MYBABY_AGENT_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({...body,operation:'get_baby_summary',args:{}})}).catch(()=>null);
  if(res?.status===200){ready=true;break;}await new Promise(r=>setTimeout(r,2000));
 }
 check(ready,'grant_not_ready');
 const responses=await Promise.all(Array.from({length:8},()=>call()));
 check(responses.every(r=>r.status===200),'concurrent_status');
 const results=await Promise.all(responses.map(r=>r.json())) as {data:{id:string};replayed?:boolean}[];
 check(new Set(results.map(r=>r.data.id)).size===1&&results.filter(r=>r.replayed).length===7,'atomic_one_commit_seven_replays');
 report.checks.push('atomic_one_commit_seven_replays');
 // Deliberately discard a committed reply, then retry the exact inbound message.
 await (await call()).body?.cancel();
 const retry=await call();check(retry.status===200&&(await retry.json() as {replayed:boolean}).replayed,'lost_response_replay');
 report.checks.push('lost_response_replay');check(ledger().receipts===1,'one_receipt');
}finally{
 // Always withdraw grants, even if concurrency or transport checks fail.
 deploy(false);
}
let revoked=false;
for(let i=0;i<20;i++){const response=await call().catch(()=>null);if(response?.status===403){revoked=true;break;}await new Promise(r=>setTimeout(r,2000));}
check(revoked,'revoked_receipt_replay_must_be_denied');check(ledger().receipts===1,'revocation_preserves_receipt');
report.checks.push('revoked_receipt_replay_denied','receipt_preserved');report.status='passed';report.finishedAt=new Date().toISOString();
writeFileSync('.migration/rc/agent-revocation.json',JSON.stringify(report),{mode:0o600});
console.log('PASS: isolated D1 atomic concurrent mutation, discarded-response replay, grant withdrawal denies committed receipt replay; grants restored empty.');
}
main().catch(error=>{
 const failure=error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:'private_transport_or_control_plane_error';
 writeFileSync(`.migration/rc/agent-revocation-failed-${Date.now()}.json`,JSON.stringify({...report,failure,finishedAt:new Date().toISOString()}),{mode:0o600});
 console.error('Agent regression failed:',failure);process.exitCode=1;
});
