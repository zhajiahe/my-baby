import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const target=JSON.parse(readFileSync('.migration/target.json','utf8')),secrets=JSON.parse(readFileSync('.migration/secrets.json','utf8'));
if(target.workerName!=='mybaby-web-migration-test'||new URL(target.origin).hostname.split('.')[0]!==target.workerName)throw new Error('isolated_target_required');
function check(value:unknown,code:string){if(!value)throw new Error(code);}
async function main(){
 const identity={source:'weixin',botId:'cloud-migration-test-bot',userId:'cloud-migration-test-user',messageId:crypto.randomUUID()};
 const req={...identity,operation:'create_growth_record',operationKey:'op_0',args:{date:'2026-10-10',weight:10.5,notes:'Synthetic Cloudflare agent acceptance'}};
 const call=(body:unknown)=>fetch(target.origin+'/api/agent/v1',{method:'POST',signal:AbortSignal.timeout(60000),
  headers:{authorization:`Bearer ${secrets.MYBABY_AGENT_TOKEN}`,'content-type':'application/json'},body:JSON.stringify(body)});
 const ids:string[]=[];
 try{
  let ready=false;for(let attempt=0;attempt<10;attempt++){
   if((await call({...req,operation:'get_baby_summary',args:{}})).status===200){ready=true;break;}
   await new Promise(resolve=>setTimeout(resolve,2000));
  }check(ready,'test_grant_ready');
  const responses=await Promise.all(Array.from({length:8},()=>call(req)));
  check(responses.every(r=>r.status===200),'real_d1_concurrent_batch');
  const results=await Promise.all(responses.map(r=>r.json())) as any[];
  check(new Set(results.map(r=>r.data.id)).size===1,'real_d1_one_mutation');ids.push(results[0].data.id);
  check(results.filter(r=>r.replayed).length===7,'real_d1_replay');
  check((await call({...req,args:{...req.args,weight:11}})).status===409,'payload_collision');
  check((await call({...req,operation:'create_milestone',args:{date:'2026-10-10',title:'Synthetic'}})).status===409,'cross_tool_collision');
  const milestone=await call({...req,operation:'create_milestone',operationKey:'op_1',args:{date:'2026-10-10',title:'Synthetic Cloudflare agent acceptance',tags:['synthetic']}});
  check(milestone.status===200,'real_d1_milestone');ids.push((await milestone.json() as any).data.id);
  check((await call({...req,operation:'list_growth_records',args:{limit:10}})).status===200,'real_d1_scoped_read');
  check((await call({...req,userId:'forbidden'})).status===403,'real_d1_exact_identity');
  console.log('PASS: real deployed D1, eight racing requests, one mutation/seven replays, payload/cross-tool 409, distinct key/milestone, scoped reads and exact identity.');
 }finally{
  const body={batch:[{sql:"SELECT value FROM deployment_guard WHERE name='environment'"}]};
  const query=(value:unknown)=>{writeFileSync('.migration/agent-cleanup.json',JSON.stringify(value),{mode:0o600});return JSON.parse(execFileSync('cf',['d1','query',target.databaseId,'--body','@.migration/agent-cleanup.json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));};
  check(query(body)[0].results[0].value==='mybaby-cloudflare-migration-test','cleanup_guard');
  query({batch:[...['growth_records','milestones'].map(table=>({sql:`DELETE FROM ${table} WHERE id IN (SELECT json_extract(result,'$.data.id') FROM agent_operations WHERE source=? AND botId=? AND messageId=?)`,params:[identity.source,identity.botId,identity.messageId]})),...ids.flatMap(id=>['growth_records','milestones'].map(table=>({sql:`DELETE FROM ${table} WHERE id=?`,params:[id]}))),
   {sql:'DELETE FROM agent_operations WHERE source=? AND botId=? AND messageId=?',params:[identity.source,identity.botId,identity.messageId]}]});
 }
}
main().catch(error=>{console.error('Cloud Agent smoke stopped:',error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:'private_error');process.exitCode=1;});
