import type { AgentStore, Receipt, ReceiptKey, AgentResult } from './service';
import { repository, newRow, insert, type Database, type Row } from '../d1-repository';
const condition='source=? AND botId=? AND messageId=? AND operationKey=?';
const values=(key:ReceiptKey)=>[key.source,key.botId,key.messageId,key.operationKey];
export function d1Store(db:Database):AgentStore {
 const repo=repository(db);
 const findReceipt=async(key:ReceiptKey):Promise<Receipt|null>=>{
  const row=await db.prepare(`SELECT payloadHash,result FROM agent_operations WHERE ${condition}`).bind(...values(key)).first<{payloadHash:string;result:string}>();
  return row?{payloadHash:row.payloadHash,result:JSON.parse(row.result)}:null;
 };
 return {
  async baby(id) {const row=await repo.baby.findUnique({where:{id}});return row?{name:row.name,birthDate:row.birthDate}:null;},
  async growth(babyId,args) {return repo.growthRecord.findMany({where:{babyId,date:{
   ...(args.from?{gte:`${args.from}T00:00:00.000Z`}:{}),
   ...(args.to?{lt:new Date(Date.parse(`${args.to}T00:00:00.000Z`)+86400000).toISOString()}:{}),
  }},take:args.limit as number,orderBy:[{date:'desc'},{id:'desc'}],select:{id:true,date:true,weight:true,height:true,headCircumference:true}});},
  async media(babyId,args) {return repo.mediaItem.findMany({where:{babyId,...(args.mediaType?{mediaType:args.mediaType as string}:{}),date:{
   ...(args.from?{gte:`${args.from}T00:00:00.000Z`}:{}),
   ...(args.to?{lt:new Date(Date.parse(`${args.to}T00:00:00.000Z`)+86400000).toISOString()}:{}),
  }},take:args.limit as number,orderBy:[{date:'desc'},{id:'desc'}],select:{date:true,mediaType:true,format:true,title:true}});},
  async album(babyId) {
   const [total,images,videos]=await Promise.all([repo.mediaItem.count({where:{babyId}}),
    repo.mediaItem.count({where:{babyId,mediaType:'IMAGE'}}),repo.mediaItem.count({where:{babyId,mediaType:'VIDEO'}})]);
   if(!total)return{total:0,images:0,videos:0,firstDate:null,latestDate:null,months:[]};
   const [latest,first,rows]=await Promise.all([
    repo.mediaItem.findFirst({where:{babyId},orderBy:[{date:'desc'},{id:'desc'}],select:{date:true}}),
    repo.mediaItem.findFirst({where:{babyId},orderBy:[{date:'asc'},{id:'asc'}],select:{date:true}}),
    // Month rollup is computed here so the model never does arithmetic. Capped at the repository maximum.
    repo.mediaItem.findMany({where:{babyId},take:10000,orderBy:[{date:'desc'}],select:{date:true}})]);
   const counts=new Map<string,number>();
   for(const row of rows){const month=String(row.date).slice(0,7);counts.set(month,(counts.get(month)??0)+1);}
   const months=[...counts.entries()].sort((a,b)=>a[0]<b[0]?1:-1).slice(0,6).map(([month,count])=>({month,count}));
   const day=(row:Record<string,unknown>|null)=>row?String(row.date).slice(0,10):null;
   return{total,images,videos,firstDate:day(first),latestDate:day(latest),months};
  },
  findReceipt,
  transaction:async()=>{throw new Error('d1_interactive_transactions_unsupported');},
  isUniqueConflict:()=>false,
  async atomicWrite(request,babyId,key,payloadHash,baby) {
   const a=request.args;
   const table=request.operation==='create_growth_record'?'growth_records'
    :request.operation==='create_media_record'?'media_items':'milestones';
   let row:Row;
   if(table==='media_items'){
    // The URL is derived here, never accepted from the caller. Object existence,
    // size, MIME and container signature are verified by the pre-commit hook.
    const objectKey=String(a.key), format=objectKey.slice(objectKey.lastIndexOf('.')+1);
    row=newRow('media_items',{babyId,date:new Date(`${a.date}T00:00:00.000Z`),title:a.title??'',
     description:a.description,url:`/api/media/${objectKey}`,mediaType:a.mediaType,format,
     thumbnailUrl:a.thumbnailKey?`/api/media/${a.thumbnailKey}`:null,duration:a.duration});
   } else {
    row=newRow(table,{babyId,date:new Date(`${a.date}T00:00:00.000Z`),
     ...(table==='growth_records'?{weight:a.weight,height:a.height,headCircumference:a.headCircumference,notes:a.notes}
       :{title:a.title,description:a.description,tags:a.tags??[]})});
   }
   const fields=table==='growth_records'?['id','date','weight','height','headCircumference']
    :table==='media_items'?['id','date','mediaType','format']:['id','date','title'];
   const result:AgentResult={operation:request.operation,baby,data:Object.fromEntries(fields.map(k=>[k,row[k]]))};
   const receipt={payloadHash,result};
   try {
    // Receipt FIRST: losing duplicate batches fail before their business insert.
    // Any later FK/constraint failure rolls back the receipt as well.
    await db.batch([
     db.prepare('INSERT INTO agent_operations(id,source,botId,messageId,operationKey,payloadHash,result,createdAt) VALUES(?,?,?,?,?,?,?,?)')
       .bind(crypto.randomUUID(),...values(key),payloadHash,JSON.stringify(result),new Date().toISOString()),
     insert(db,table,row),
    ]);
    return {receipt,replayed:false};
   } catch(error) {
    const committed=await findReceipt(key);
    if(committed)return {receipt:committed,replayed:true};
    throw error;
   }
  },
 };
}
