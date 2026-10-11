import {readFileSync,writeFileSync} from 'node:fs';import{execFileSync}from'node:child_process';
const target=JSON.parse(readFileSync('.migration/weixin-acceptance-target.json','utf8')),secrets=JSON.parse(readFileSync('.migration/weixin-acceptance-secrets.json','utf8')),web=JSON.parse(readFileSync('.migration/target.json','utf8'));
if(target.workerName!=='mybaby-weixin-acceptance'||new URL(target.origin).hostname.split('.')[0]!==target.workerName)throw new Error('separate_acceptance_worker_required');
const call=(path:string,body?:unknown)=>fetch(target.origin+path,{method:body?'POST':'GET',headers:{authorization:`Bearer ${secrets.WEIXIN_ADMIN_TOKEN}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const check=(ok:unknown,code:string)=>{if(!ok)throw new Error(code);};
const report:any={kind:'synthetic-ilink-real-openrouter-real-cloud-agent-d1',realWeixin:false,cases:[],startedAt:new Date().toISOString()};
async function main(){
 await call('/admin/session/pause',{});const status=await (await call('/admin/session/status')).json() as any;
 check((await call('/admin/session/bind',{botId:'cloud-migration-test-bot',allowedUserIds:['cloud-migration-test-user'],apiBaseUrl:'https://ilinkai.weixin.qq.com',discardPending:true})).ok,'synthetic_binding');
 const previous=await(await call('/acceptance/status')).json() as any;const usageOffset=previous.modelUsage.length;
 const root=BigInt(Date.now())*BigInt(10000);
 const cases=[{name:'lost-business-response',messageId:String(root+BigInt(1)),businessLoss:true,sendFault:'none',weight:10.51},
  {name:'confirmed-send-429',messageId:String(root+BigInt(2)),businessLoss:false,sendFault:'429',weight:10.52},
  {name:'ambiguous-send-500',messageId:String(root+BigInt(3)),businessLoss:false,sendFault:'500',weight:10.53}];
 for(const item of cases){const body={...item,text:`合成验收：请只新增一条成长记录，日期2026-10-10，体重${item.weight}公斤，备注synthetic-acceptance。不要查询其他记录。`};
  check((await call('/acceptance/enqueue',body)).ok,'enqueue');check((await call('/acceptance/enqueue',body)).ok,'duplicate_enqueue');}
 check((await call('/admin/session/start',{})).ok,'start');
 let latest:any;
 for(let i=0;i<80;i++){
  await new Promise(r=>setTimeout(r,3000));latest=await (await call('/acceptance/status')).json();latest.sends=latest.sends.filter((s:any)=>cases.some(c=>c.messageId===s.messageId));
  if(latest.sends.some((s:any)=>s.state==='ambiguous')&&latest.sends.filter((s:any)=>s.state==='accepted').length>=2)break;
 }
 check(latest.sends.some((s:any)=>s.state==='ambiguous'&&s.attempts===1),'ambiguous_not_resent');
 check(latest.sends.some((s:any)=>s.state==='accepted'&&s.attempts===2),'429_stable_retry');
 for(const item of cases){
  writeFileSync('.migration/qa-query.json',JSON.stringify({batch:[{sql:"SELECT COUNT(*) AS n FROM agent_operations WHERE source='weixin' AND botId=? AND messageId=?",params:['cloud-migration-test-bot',item.messageId]},
   {sql:"SELECT COUNT(*) AS n FROM growth_records WHERE id IN (SELECT json_extract(result,'$.data.id') FROM agent_operations WHERE botId=? AND messageId=?)",params:['cloud-migration-test-bot',item.messageId]}]}),{mode:0o600});
  const result=JSON.parse(execFileSync('cf',['d1','query',web.databaseId,'--body','@.migration/qa-query.json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  check(result[0].results[0].n===1&&result[1].results[0].n===1,'one_receipt_one_growth');
  report.cases.push({case:item.name,status:'passed',duplicateInbound:2,receipts:1,mutations:1});
 }
 check(latest.sends.filter((s:any)=>s.state==='accepted').every((s:any)=>s.reply.includes('已记录')&&s.reply.includes('记录 ID')),'truthful_business_reply');
 report.modelUsage=latest.modelUsage.slice(usageOffset);report.openRouterCostUsd=report.modelUsage.every((u:any)=>typeof u.costUsd==='number')?report.modelUsage.reduce((sum:number,u:any)=>sum+u.costUsd,0):null;
 report.modelCalls=report.modelUsage.length;report.session=await (await call('/admin/session/status')).json();report.status='passed';
 console.log('PASS: isolated DO/Alarm/Queue, real OpenRouter + Agent API + D1, duplicate input, committed-response-loss recovery, confirmed 429 retry, ambiguous 500 no-resend and truthful synthetic reply. Not real Weixin acceptance.');
}
try{await main();}catch(error){report.status='failed';report.failure=error instanceof Error&&/^[a-z0-9_]+$/.test(error.message)?error.message:'private_error';console.error('Synthetic acceptance failed:',report.failure);process.exitCode=1;}
finally{await call('/admin/session/pause',{}).catch(()=>{});report.finishedAt=new Date().toISOString();const data=JSON.stringify(report,null,2);writeFileSync(`.migration/weixin-acceptance-report-${report.finishedAt.replace(/[:.]/g,'-')}.json`,data,{mode:0o600});writeFileSync('.migration/weixin-acceptance-report.json',data,{mode:0o600});}
