import {createHash} from 'node:crypto';
import {newRow,insert,decode,type Database,type Row} from './d1-repository';
export const uploadIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class UploadError extends Error {constructor(public code:string,public status:number){super(code);}}
export async function createMediaOnce(db:Database,id:string,data:Row):Promise<Row>{
 if(!uploadIdPattern.test(id))throw new UploadError('invalid_upload_id',400);
 const row=newRow('media_items',{...data,id});
 const payload=Object.fromEntries(Object.keys(row).sort().filter(k=>!['createdAt','updatedAt'].includes(k)).map(k=>[k,row[k]]));
 const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 const replay=async()=>{
  const receipt=await db.prepare('SELECT payloadHash,result FROM media_upload_receipts WHERE id=?').bind(id).first<{payloadHash:string;result:string}>();
  if(!receipt)return null;
  if(receipt.payloadHash!==hash)throw new UploadError('upload_payload_conflict',409);
  if(!await db.prepare('SELECT id FROM media_items WHERE id=?').bind(id).first())throw new UploadError('upload_already_deleted',410);
  return {...JSON.parse(receipt.result),replayed:true};
 };
 const existing=await replay();if(existing)return existing;
 try{
  await db.batch([db.prepare('INSERT INTO media_upload_receipts(id,payloadHash,result,createdAt) VALUES(?,?,?,?)')
   .bind(id,hash,JSON.stringify(decode('media_items',row)),row.createdAt),insert(db,'media_items',row)]);
  return decode('media_items',row);
 }catch(error){const committed=await replay();if(committed)return committed;throw error;}
}
