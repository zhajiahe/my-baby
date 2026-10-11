import type { AgentStore, Receipt, ReceiptKey, AgentResult } from './service';
import { repository, newRow, insert, type Database } from '../d1-repository';
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
  findReceipt,
  transaction:async()=>{throw new Error('d1_interactive_transactions_unsupported');},
  isUniqueConflict:()=>false,
  async atomicWrite(request,babyId,key,payloadHash,baby) {
   const a=request.args, table=request.operation==='create_growth_record'?'growth_records':'milestones';
   const row=newRow(table,{babyId,date:new Date(`${a.date}T00:00:00.000Z`),
     ...(table==='growth_records'?{weight:a.weight,height:a.height,headCircumference:a.headCircumference,notes:a.notes}
       :{title:a.title,description:a.description,tags:a.tags??[]})});
   const fields=table==='growth_records'?['id','date','weight','height','headCircumference']:['id','date','title'];
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
