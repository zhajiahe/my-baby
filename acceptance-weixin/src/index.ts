import bridge from '../../weixin/src/index.js';
export {WeixinSession} from '../../weixin/src/session.js';
import {authorized,json} from '../../weixin/src/http.js';
import type {Env as BridgeEnv} from '../../weixin/src/types.js';
interface Env extends BridgeEnv {ILINK_ACCEPTANCE:DurableObjectNamespace;REAL_MYBABY_ORIGIN:string;REAL_MYBABY_API:Fetcher}
// A separate namespace containing synthetic protocol data only. No real QR,
// Weixin credential, source identity or production session is used here.
export class SyntheticILink {
 constructor(private ctx:DurableObjectState,private env:Env){ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS inbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sends(clientId TEXT PRIMARY KEY,attempts INTEGER NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS faults(messageId TEXT PRIMARY KEY,businessLoss INTEGER NOT NULL DEFAULT 0,sendFault TEXT NOT NULL DEFAULT 'none');`);}
 async fetch(request:Request){
  const path=new URL(request.url).pathname;
  if(path==='/api/agent/v1'&&request.method==='POST'){
   const body=await request.text();const data=JSON.parse(body);
   if(data.botId!=='cloud-migration-test-bot'||data.userId!=='cloud-migration-test-user')return json({error:'synthetic_identity_required'},403);
   const upstream=await this.env.REAL_MYBABY_API.fetch(this.env.REAL_MYBABY_ORIGIN+'/api/agent/v1',{method:'POST',headers:request.headers,body});
   if(upstream.ok&&typeof data.operation==='string'&&data.operation.startsWith('create_')){
    const lost=this.ctx.storage.sql.exec('UPDATE faults SET businessLoss=0 WHERE messageId=? AND businessLoss=1 RETURNING messageId',data.messageId).toArray().length;
    if(lost){await upstream.body?.cancel();return json({error:'injected_response_loss'},503);}
   }return upstream;
  }
  if(path==='/acceptance/model-usage'){
   const data=await request.json() as Record<string,unknown>;const records=this.ctx.storage.kv.get<unknown[]>('modelUsage')||[];
   records.push(Object.fromEntries(['promptTokens','completionTokens','costUsd','latencyMs'].map(k=>[k,typeof data[k]==='number'&&Number.isFinite(data[k])?data[k]:null])));
   this.ctx.storage.kv.put('modelUsage',records.slice(-100));return json({ok:true});
  }
  if(path==='/acceptance/enqueue'){
   const data=await request.json() as {messageId:string;text:string;sendFault?:string;businessLoss?:boolean};
   if(!/^\d{1,30}$/.test(data.messageId)||typeof data.text!=='string'||data.text.length>1000||!['none','429','500'].includes(data.sendFault||'none'))return json({error:'invalid_synthetic_fixture'},400);
   this.ctx.storage.sql.exec('INSERT OR IGNORE INTO faults(messageId,businessLoss,sendFault) VALUES(?,?,?)',data.messageId,data.businessLoss?1:0,data.sendFault||'none');
   const payload={message_id:data.messageId,from_user_id:'cloud-migration-test-user',to_user_id:'cloud-migration-test-bot',
    message_type:1,message_state:0,context_token:data.messageId,create_time_ms:Date.now(),item_list:[{type:1,text_item:{text:data.text}}]};
   this.ctx.storage.sql.exec('INSERT INTO inbox(payload) VALUES(?)',JSON.stringify(payload));return json({queued:true});
  }
  if(path==='/acceptance/status'){
   const sends=this.ctx.storage.sql.exec<{attempts:number;state:string;payload:string}>('SELECT attempts,state,payload FROM sends').toArray();
   return json({synthetic:true,modelUsage:this.ctx.storage.kv.get('modelUsage')||[],sends:sends.map(row=>({messageId:JSON.parse(row.payload).msg.context_token,attempts:row.attempts,state:row.state,reply:JSON.parse(row.payload).msg.item_list[0].text_item.text})),inbound:this.ctx.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM inbox').toArray()[0].n});
  }
  if(path==='/acceptance/business-fault'){
   const data=await request.json() as {messageId:string};const row=this.ctx.storage.sql.exec<{businessLoss:number}>('UPDATE faults SET businessLoss=0 WHERE messageId=? AND businessLoss=1 RETURNING 1 AS businessLoss',data.messageId).toArray()[0];return json({lose:!!row});
  }
  if(path==='/ilink/bot/getupdates'){
   const data=await request.json() as {get_updates_buf:string};
   const rows=this.ctx.storage.sql.exec<{seq:number;payload:string}>('SELECT seq,payload FROM inbox WHERE seq>? ORDER BY seq LIMIT 20',Number(data.get_updates_buf)||0).toArray();
   if(!rows.length)await new Promise(resolve=>setTimeout(resolve,25000));
   return json({ret:0,msgs:rows.map(row=>JSON.parse(row.payload)),get_updates_buf:String(rows.at(-1)?.seq??data.get_updates_buf??0),longpolling_timeout_ms:30000});
  }
  if(path==='/ilink/bot/sendmessage'){
   const data=await request.json() as {msg:{client_id:string;context_token:string}};const id=data.msg.client_id;
   const fault=this.ctx.storage.sql.exec<{sendFault:string}>('SELECT sendFault FROM faults WHERE messageId=?',data.msg.context_token).toArray()[0]?.sendFault;
   const previous=this.ctx.storage.sql.exec<{attempts:number}>('SELECT attempts FROM sends WHERE clientId=?',id).toArray()[0];
   const attempts=(previous?.attempts??0)+1;
   this.ctx.storage.sql.exec('INSERT INTO sends(clientId,attempts,payload,state) VALUES(?,?,?,?) ON CONFLICT(clientId) DO UPDATE SET attempts=excluded.attempts,state=excluded.state',id,attempts,JSON.stringify(data),fault==='429'&&attempts===1?'rejected':fault==='500'&&attempts===1?'ambiguous':'accepted');
   if(fault==='429'&&attempts===1)return new Response(null,{status:429});
   if(fault==='500'&&attempts===1)return new Response(null,{status:500});
   return json({ret:0});
  }
  return json({error:'synthetic_route_not_found'},404);
 }
}
export default {
 async fetch(request:Request,env:Env){
  if(env.DEPLOYMENT_KIND!=='synthetic-acceptance')return json({error:'acceptance_disabled'},503);
  const path=new URL(request.url).pathname;
  const mock=env.ILINK_ACCEPTANCE.get(env.ILINK_ACCEPTANCE.idFromName('synthetic'));
  if(path.startsWith('/acceptance/')){
   if(!await authorized(request,env.WEIXIN_ADMIN_TOKEN))return json({error:'unauthorized'},401);
   if(path==='/acceptance/transport-check'){
    const results=[];
    for(const redirect of ['error','manual'] as const){try{
     const res=await mock.fetch('https://synthetic/api/agent/v1',{method:'POST',redirect,headers:{authorization:`Bearer ${env.MYBABY_AGENT_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({source:'weixin',botId:'cloud-migration-test-bot',userId:'cloud-migration-test-user',messageId:'1',operation:'get_baby_summary',operationKey:'scope',args:{}})});
     results.push({redirect,status:res.status});await res.body?.cancel();
    }catch(error){const message=String(error);results.push({redirect,redirectError:/redirect/i.test(message),headerError:/header/i.test(message),namespaceError:/Durable|service|binding/i.test(message)});}}
    return json(results);
   }
   if(path==='/acceptance/session-debug')return env.WEIXIN_SESSION.get(env.WEIXIN_SESSION.idFromName('personal')).fetch(new Request('https://session/acceptance-debug',request));
   return mock.fetch(request);
  }
  if(path==='/api/agent/v1'&&request.method==='POST'){
   if(!await authorized(request,env.MYBABY_AGENT_TOKEN||''))return json({error:'unauthorized'},401);
   return mock.fetch(request);
  }
  return bridge.fetch(request,env);
 },
 queue:bridge.queue,
} satisfies ExportedHandler<Env>;
