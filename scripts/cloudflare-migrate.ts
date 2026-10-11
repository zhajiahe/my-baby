// Operator-only Node utility. Never bundled into the Worker.
import {readFileSync,writeFileSync,mkdirSync,chmodSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
const directory='.migration';mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
const read=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const save=(path:string,value:unknown)=>{writeFileSync(path,JSON.stringify(value),{mode:0o600});chmodSync(path,0o600);};
const tables=['babies','growth_records','milestones','media_items','agent_operations'];
const target=read(`${directory}/target.json`);
if(target.workerName!=='mybaby-web-migration-test'||target.bucketName!=='mybaby-cloudflare-migration-test-media'||!target.databaseId)throw new Error('test_target_required');
function query(batch:{sql:string;params?:unknown[]}[]){
 const path=`${directory}/query.json`;save(path,{batch});
 try{return JSON.parse(execFileSync('cf',['d1','query',target.databaseId,'--body',`@${path}`],{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']}));}
 catch{throw new Error('isolated_d1_query_failed_private_inputs_not_logged');}
}
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const canonical=(row:Record<string,unknown>)=>JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(k=>[k,row[k]])));
function sourceEnv(){const map:Record<string,string>={};for(const line of readFileSync('.env','utf8').split('\n')){
 if(line.trim().startsWith('#')||!line.includes('='))continue;const i=line.indexOf('=');map[line.slice(0,i).trim()]=line.slice(i+1).trim().replace(/^['"]|['"]$/g,'');}return map;}
async function main(){
 const command=process.argv[2];
 if(command==='export'){
  const url=process.env.MYBABY_MIGRATION_SOURCE_URL||sourceEnv().DATABASE_URL;
  if(!url)throw new Error('source_url_required');const client=new PrismaClient({datasourceUrl:url});
  try{
   const rows=await client.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const exists=await tx.$queryRawUnsafe<{name:string|null}[]>("SELECT to_regclass('public.agent_operations')::text AS name");
    return {babies:await tx.baby.findMany(),growth_records:await tx.growthRecord.findMany(),milestones:await tx.milestone.findMany(),
     media_items:await tx.mediaItem.findMany(),agent_operations:exists[0].name?await tx.agentOperation.findMany():[]};
   },{isolationLevel:'RepeatableRead',timeout:60000});
   const snapshot={version:1,exportedAt:new Date().toISOString(),rows};
   save(`${directory}/source.json`,snapshot);save(`${directory}/source-${Date.now()}.json`,snapshot);
   console.log('Read-only consistent source snapshot saved privately. Counts:',Object.fromEntries(tables.map(t=>[t,(rows as any)[t].length])));
  }finally{await client.$disconnect();}return;
 }
 if(!['schema','import','validate','media'].includes(command))throw new Error('usage_export_schema_import_validate_media');
 const databaseMetadata=JSON.parse(execFileSync('cf',['d1','get',target.databaseId],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 if(databaseMetadata.name!=='mybaby-cloudflare-migration-test')throw new Error('unexpected_d1_name');
 if(command==='schema'){
  // UUID/name match is checked before even applying the test schema.
  const identity=query([{sql:'SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'deployment_guard\''}]);
  if(identity[0].results.length){const existing=query([{sql:"SELECT value FROM deployment_guard WHERE name='environment'"}]);
   if(existing[0].results[0]?.value!=='mybaby-cloudflare-migration-test')throw new Error('test_guard_required');}
  query([{sql:readFileSync('cloudflare/migrations/0001_initial.sql','utf8')},{sql:readFileSync('cloudflare/migrations/0002_media_upload_receipts.sql','utf8')}]);console.log('Isolated D1 schema ready.');return;
 }
 const guard=query([{sql:"SELECT value FROM deployment_guard WHERE name='environment'"}]);
 if(guard[0].results[0]?.value!=='mybaby-cloudflare-migration-test')throw new Error('test_guard_required');
 const snapshot=read(`${directory}/source.json`);if(snapshot.version!==1)throw new Error('snapshot_version');
 const objects=new Set<string>();const domain=new URL(target.sourcePublicDomain);
 function mediaURL(url:string|null){if(!url)return url;const parsed=new URL(url);
  if(parsed.origin!==domain.origin)throw new Error('unapproved_media_origin');
  const prefix=domain.pathname.replace(/\/$/,'')+'/';
  if(!parsed.pathname.startsWith(prefix))throw new Error('invalid_media_prefix');
  const key=decodeURIComponent(parsed.pathname.slice(prefix.length));
  if(!key||key.startsWith('/')||key.includes('..'))throw new Error('invalid_media_key');objects.add(key);
  return '/api/media/legacy/'+key.split('/').map(encodeURIComponent).join('/');}
 const rows:Record<string,Record<string,any>[]>={};
 for(const table of tables)rows[table]=snapshot.rows[table].map((original:Record<string,any>)=>{
  const row={...original};if(table==='milestones')row.tags=JSON.stringify(row.tags);
  if(table==='agent_operations')row.result=JSON.stringify(row.result);
  if(table==='babies')row.avatar=mediaURL(row.avatar);
  if(table==='media_items'){row.url=mediaURL(row.url);row.thumbnailUrl=mediaURL(row.thumbnailUrl);}
  return row;});
 const babyIds=new Set(rows.babies.map(r=>r.id));
 for(const table of ['growth_records','milestones','media_items'])if(rows[table].some(r=>!babyIds.has(r.babyId)))throw new Error('source_relation_invalid');
 for(const table of tables){if(new Set(rows[table].map(r=>r.id)).size!==rows[table].length)throw new Error('duplicate_source_id');
  for(const row of rows[table])for(const field of ['date','birthDate','createdAt','updatedAt'])if(field in row&&!Number.isFinite(Date.parse(row[field])))throw new Error('invalid_source_date');}
 if(command==='media'){
  if(new URL(target.origin).hostname.split('.')[0]!==target.workerName)throw new Error('unexpected_target_origin');
  const secrets=read(`${directory}/secrets.json`),report:any[]=existsSync(`${directory}/media-report.json`)?read(`${directory}/media-report.json`):[];
  for(const key of objects){
   if(report.some(r=>r.key===key&&r.verified))continue;
   let response:Response|undefined;
   for(let attempt=0;attempt<5;attempt++){
    try{response=await fetch(`${target.origin}/api/migration/copy-media`,{method:'POST',signal:AbortSignal.timeout(180000),
     headers:{authorization:`Bearer ${secrets.MIGRATION_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({key})});
     if(response.ok||![429,500,502,503,504].includes(response.status))break;await response.body?.cancel();
    }catch{response=undefined;}
    await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));
   }
   if(!response?.ok)throw new Error(`media_copy_failed_http_${response?.status||0}`);
   report.push({key,...await response.json() as object});save(`${directory}/media-report.json`,report);
   console.log(`Verified copied objects: ${report.length}/${objects.size}`);}
  return;
 }
 if(command==='import'){
  if(process.argv.includes('--reset-test-data'))query([{sql:'DELETE FROM media_upload_receipts'},...[...tables].reverse().map(table=>({sql:`DELETE FROM ${table}`}))]);
  for(const table of tables){const statements=rows[table].map(row=>{
   const keys=Object.keys(row);if(keys.some(k=>!/^\w+$/.test(k)))throw new Error('invalid_column');
   return {sql:`INSERT INTO ${table} (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${keys.filter(k=>k!=='id').map(k=>`"${k}"=excluded."${k}"`).join(',')}`,
    params:keys.map(k=>row[k])};});
   for(let i=0;i<statements.length;i+=50)query(statements.slice(i,i+50));}
  console.log('Snapshot imported only into guarded test D1.');
 }
 const report:Record<string,unknown>={};
 for(const table of tables){const actual=query([{sql:`SELECT * FROM ${table}`}])[0].results;
  const hash=(data:Record<string,unknown>[])=>sha(data.map(canonical).sort().join('\n'));
  if(hash(actual)!==hash(rows[table]))throw new Error(`target_data_mismatch_${table}`);
  report[table]={count:actual.length,contentHash:hash(actual),idsHash:sha(actual.map((r:any)=>r.id).sort().join('\n'))};}
 if(query([{sql:'PRAGMA foreign_key_check'}])[0].results.length)throw new Error('target_foreign_key_invalid');
 if(process.argv.includes('--require-media')){const copied=read(`${directory}/media-report.json`);
  if(objects.size!==copied.length||[...objects].some(k=>!copied.some((r:any)=>r.key===k&&r.verified)))throw new Error('media_copy_incomplete');}
 save(`${directory}/validation-report.json`,{validatedAt:new Date().toISOString(),tables:report,r2References:objects.size,mediaCopied:!!process.argv.includes('--require-media')});
 console.log('IDs, every scalar field, JSON tags, receipts, UTC dates and relations match. R2 references:',objects.size);
}
main().catch(error=>{const code=error instanceof Error&&/^[a-z][a-z0-9_]+$/.test(error.message)?error.message:'private_error';
 console.error('Migration stopped safely:',code,'Private inputs/credentials/data are not logged.');process.exitCode=1;});
