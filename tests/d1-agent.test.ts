import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {repository,type Database,type Statement,type SQLValue} from '../src/lib/d1-repository';
import {d1Store} from '../src/lib/agent/d1-store';
import {executeOperation} from '../src/lib/agent/service';
import {mediaNamespace} from '../shared/agent';
import {createMediaOnce} from '../src/lib/media-upload';
function harness(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('cloudflare/migrations/0001_initial.sql','utf8'));sqlite.exec(readFileSync('cloudflare/migrations/0002_media_upload_receipts.sql','utf8'));
 const pending=new WeakMap<Statement,()=>unknown>();
 const db:Database={prepare(sql){let values:SQLValue[]=[];const native=sqlite.prepare(sql);const stmt:Statement={
  bind(...v){values=v;return stmt;},async all<T>(){return {results:native.all(...values) as T[]};},
  async first<T>(){return (native.get(...values)??null) as T|null;},async run(){return native.run(...values);}};
  pending.set(stmt,()=>native.run(...values));return stmt;},async batch(statements){
   sqlite.exec('BEGIN');try{const result=statements.map(s=>pending.get(s)!());sqlite.exec('COMMIT');return result;}
   catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const repo=repository(db);return {db,repo,sqlite,store:d1Store(db)};
}
test('media retry after lost response commits once; conflicts and deleted replay fail closed',async()=>{
 const h=await setup();try{
  const id=crypto.randomUUID(),data={babyId:'baby',date:new Date('2026-10-10'),title:'synthetic',url:`/api/media/uploads/${id}.png`,mediaType:'IMAGE',format:'png'};
  const results=await Promise.all(Array.from({length:5},()=>createMediaOnce(h.db,id,data)));
  assert.equal(new Set(results.map(r=>r.id)).size,1);assert.equal(await h.repo.mediaItem.count(),1);
  await assert.rejects(createMediaOnce(h.db,id,{...data,title:'changed'}),/upload_payload_conflict/);
  await h.repo.mediaItem.delete({where:{id}});await assert.rejects(createMediaOnce(h.db,id,data),/upload_already_deleted/);
 }finally{h.sqlite.close();}
});
const grants=JSON.stringify([{source:'weixin',botId:'bot',userId:'allowed',babyId:'baby'}]);
const request={source:'weixin',botId:'bot',userId:'allowed',messageId:'msg',operationKey:'op_0',operation:'create_growth_record',args:{date:'2026-10-10',weight:10.5}};
async function setup(){const h=harness();await h.repo.baby.create({data:{id:'baby',name:'Synthetic',birthDate:new Date('2025-01-01'),gender:'boy'}});return h;}
test('D1 atomic batch: racing identical writes commit one receipt and one record',async()=>{
 const h=await setup();try{const options={store:h.store,grants,writesEnabled:true};
 const r=await Promise.all(Array.from({length:8},()=>executeOperation(request,options)));
 assert.equal(new Set(r.map(x=>x.data.id)).size,1);assert.equal(await h.repo.growthRecord.count(),1);
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM agent_operations').get()!.n,1);
 await assert.rejects(executeOperation({...request,args:{...request.args,weight:12}},options),/idempotency_conflict/);
 }finally{h.sqlite.close();}
});
test('D1 late business failure rolls receipt back; retry succeeds',async()=>{
 const h=await setup();try{h.sqlite.exec("CREATE TRIGGER reject_write BEFORE INSERT ON growth_records BEGIN SELECT RAISE(ABORT,'injected'); END;");
 await assert.rejects(executeOperation(request,{store:h.store,grants,writesEnabled:true}));
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM agent_operations').get()!.n,0);
 h.sqlite.exec('DROP TRIGGER reject_write');await executeOperation(request,{store:h.store,grants,writesEnabled:true});
 assert.equal(await h.repo.growthRecord.count(),1);
 }finally{h.sqlite.close();}
});
test('D1 cached replay still enforces grants and write switch',async()=>{
 const h=await setup();try{await executeOperation(request,{store:h.store,grants,writesEnabled:true});
 await assert.rejects(executeOperation(request,{store:d1Store(h.db),grants:'[]',writesEnabled:true}));
 await assert.rejects(executeOperation(request,{store:h.store,grants,writesEnabled:false}));
 const r=await executeOperation(request,{store:d1Store(h.db),grants,writesEnabled:true});assert.equal(r.replayed,true);
 }finally{h.sqlite.close();}
});
test('D1 relational CRUD, JSON tags, UTC dates, atomic album batch and cascade',async()=>{
 const h=await setup();try{
 const m=await h.repo.milestone.create({data:{babyId:'baby',date:new Date('2026-10-10'),title:'Synthetic',tags:['one','two']}});
 assert.deepEqual((await h.repo.milestone.findUnique({where:{id:m.id}}))!.tags,['one','two']);
 await h.repo.milestone.update({where:{id:m.id},data:{tags:[]}});
 assert.deepEqual((await h.repo.milestone.findUnique({where:{id:m.id}}))!.tags,[]);
 const media={babyId:'baby',date:new Date(),title:'',url:'/api/media/uploads/test.jpg',mediaType:'IMAGE'};
 await assert.rejects(h.repo.createMediaBatch([media,{...media,babyId:'missing'}]));assert.equal(await h.repo.mediaItem.count(),0);
 await h.repo.createMediaBatch([media,media]);assert.equal((await h.repo.baby.findFirst({include:{_count:true}}))!._count.mediaItems,2);
 await h.repo.baby.delete({where:{id:'baby'}});assert.equal(await h.repo.mediaItem.count(),0);assert.equal(await h.repo.milestone.count(),0);
 }finally{h.sqlite.close();}
});

test('D1 album reads aggregate months, filter by type and never return private URLs',async()=>{
 const h=await setup();try{
  const media=(date:string,mediaType:string,format:string)=>({babyId:'baby',date:new Date(`${date}T00:00:00.000Z`),title:'',
   url:`/api/media/legacy/${date}.${format}`,mediaType,format});
  await h.repo.createMediaBatch([media('2026-08-01','IMAGE','jpg'),media('2026-09-05','IMAGE','png'),
   media('2026-10-10','IMAGE','jpg'),media('2026-10-11','VIDEO','mp4'),media('2026-10-12','VIDEO','mp4')]);
  const read=(operation:string,operationKey:string,args:Record<string,unknown>)=>executeOperation(
   {...request,operation,operationKey,args},{store:h.store,grants,writesEnabled:false});
  const list=await read('list_media_items','op_r0',{mediaType:'VIDEO',limit:2});
  const rows=list.data.records as Record<string,unknown>[];
  assert.equal(rows.length,2);assert.ok(rows.every(row=>row.mediaType==='VIDEO'));
  assert.deepEqual(Object.keys(rows[0]).sort(),['date','format','mediaType','title']);
  assert.ok(!JSON.stringify(list).includes('/api/media'),'album reads must not expose private URLs');
  const album=await read('get_album_summary','op_r1',{});
  assert.equal(album.data.total,5);assert.equal(album.data.images,3);assert.equal(album.data.videos,2);
  assert.equal(album.data.firstDate,'2026-08-01');assert.equal(album.data.latestDate,'2026-10-12');
  assert.deepEqual(album.data.months,[{month:'2026-10',count:3},{month:'2026-09',count:1},{month:'2026-08',count:1}]);
  const range=await read('list_media_items','op_r2',{from:'2026-10-01',to:'2026-10-10',limit:30});
  assert.equal((range.data.records as unknown[]).length,1);
  // Reads are never receipts and never mutate.
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM agent_operations').get()!.n,0);
  assert.equal(await h.repo.mediaItem.count(),5);
 }finally{h.sqlite.close();}
});

test('D1 media archive derives the URL, verifies once and replays idempotently',async()=>{
 const h=await setup();try{
  const key=`${mediaNamespace('bot','allowed')}123-0.jpg`,thumb=`${mediaNamespace('bot','allowed')}123-1-thumb.jpg`;
  let verifications=0;const verifyWrite=async()=>{verifications++;};
  const mediaRequest={...request,operation:'create_media_record',args:{date:'2026-10-11',key,mediaType:'IMAGE',title:'满月'}};
  const first=await executeOperation(mediaRequest,{store:h.store,grants,writesEnabled:true,verifyWrite});
  const row=await h.repo.mediaItem.findFirst({where:{babyId:'baby'}});
  // The URL is derived from the key and never accepted from the caller.
  assert.equal(row!.url,`/api/media/${key}`);assert.equal(row!.format,'jpg');
  assert.equal(row!.mediaType,'IMAGE');assert.equal(row!.title,'满月');assert.equal(row!.duration,null);
  assert.deepEqual(first.data,{id:row!.id,date:'2026-10-11T00:00:00.000Z',mediaType:'IMAGE',format:'jpg'});
  const replay=await executeOperation(mediaRequest,{store:h.store,grants,writesEnabled:true,verifyWrite});
  assert.ok(replay.replayed);assert.equal(verifications,1);
  assert.equal(await h.repo.mediaItem.count(),1);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM agent_operations').get()!.n,1);
  // A video with a stored poster keeps both derived references.
  const videoKey=`${mediaNamespace('bot','allowed')}123-1.mp4`;
  await executeOperation({...request,operation:'create_media_record',operationKey:'op_1',
   args:{date:'2026-10-11',key:videoKey,mediaType:'VIDEO',duration:9.4,thumbnailKey:thumb}},
   {store:h.store,grants,writesEnabled:true,verifyWrite:async()=>{}});
  const video=(await h.repo.mediaItem.findMany({where:{babyId:'baby'},orderBy:{date:'desc'}})).find(item=>item.mediaType==='VIDEO');
  assert.equal(video!.url,`/api/media/${videoKey}`);assert.equal(video!.thumbnailUrl,`/api/media/${thumb}`);
  assert.equal(video!.duration,9);
 }finally{h.sqlite.close();}
});
