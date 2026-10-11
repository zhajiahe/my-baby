import{NextResponse}from'next/server';import{bindings}from'@/lib/db';import{limitedJson,equalSecret}from'@/lib/auth';
export async function POST(request:Request){
 const headers={'Cache-Control':'private, no-store'};const env=await bindings();
 if(!env.MIGRATION_TOKEN||env.MIGRATION_TOKEN.length<32||!equalSecret(request.headers.get('authorization')||'',`Bearer ${env.MIGRATION_TOKEN}`))return NextResponse.json({error:'unauthorized'},{status:401,headers});
 const guard=await env.DB.withSession('first-primary').prepare("SELECT value FROM deployment_guard WHERE name='environment'").first<{value:string}>();
 if(process.env.MYBABY_DEPLOYMENT!=='migration-test'||process.env.R2_BUCKET_NAME!=='mybaby-cloudflare-migration-test-media'||guard?.value!=='mybaby-cloudflare-migration-test')return NextResponse.json({error:'test_only'},{status:403,headers});
 const body=await limitedJson(request,512000) as {keepKeys:string[];dryRun?:boolean;candidateHash?:string};
 if(!Array.isArray(body.keepKeys)||!body.keepKeys.length||body.keepKeys.length>5000||body.keepKeys.some(k=>typeof k!=='string'||!k||k.includes('..')||k.startsWith('/')))return NextResponse.json({error:'invalid_keep_manifest'},{status:400,headers});
 // Always preserve live D1 references as well as the independently verified migration manifest.
 const refs=await env.DB.withSession('first-primary').prepare('SELECT url AS ref FROM media_items UNION SELECT thumbnailUrl FROM media_items UNION SELECT avatar FROM babies').all<{ref:string|null}>();
 const keep=new Set(body.keepKeys);
 for(const row of refs.results)if(row.ref?.startsWith('/api/media/'))keep.add(row.ref.slice('/api/media/'.length));
 const candidates:string[]=[];let cursor:string|undefined,bytes=0,scanned=0;
 const cutoff=Date.now()-24*60*60*1000; // signed PUT expires in 10 minutes; allow failed clients a full day to retry
 do{const page=await env.MEDIA.list({limit:1000,cursor});for(const object of page.objects){scanned++;if(object.key.startsWith('uploads/')&&object.uploaded.getTime()<cutoff&&!keep.has(object.key)){candidates.push(object.key);bytes+=object.size;}}
  cursor=page.truncated?page.cursor:undefined;
  if(scanned>10000)return NextResponse.json({error:'cleanup_scan_limit'},{status:409,headers});
 }while(cursor);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(candidates.slice().sort().join('\n')));
 const candidateHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 if(body.dryRun===false){
  // Maintenance freeze prevents publication racing the live-reference scan.
  if(process.env.MYBABY_WRITES_FROZEN!=='true')return NextResponse.json({error:'write_freeze_required'},{status:409,headers});
  if(body.candidateHash!==candidateHash)return NextResponse.json({error:'cleanup_manifest_changed'},{status:409,headers});
  for(let i=0;i<candidates.length;i+=1000)await env.MEDIA.delete(candidates.slice(i,i+1000));
 }
 return NextResponse.json({dryRun:body.dryRun!==false,scanned,candidates:candidates.length,bytes,candidateHash},{headers});
}
