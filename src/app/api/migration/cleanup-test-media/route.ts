import{NextResponse}from'next/server';import{bindings}from'@/lib/db';import{limitedJson,equalSecret}from'@/lib/auth';
export async function POST(request:Request){
 const headers={'Cache-Control':'private, no-store'};const env=await bindings();
 if(!env.MIGRATION_TOKEN||env.MIGRATION_TOKEN.length<32||!equalSecret(request.headers.get('authorization')||'',`Bearer ${env.MIGRATION_TOKEN}`))return NextResponse.json({error:'unauthorized'},{status:401,headers});
 const guard=await env.DB.withSession('first-primary').prepare("SELECT value FROM deployment_guard WHERE name='environment'").first<{value:string}>();
 if(process.env.MYBABY_DEPLOYMENT!=='migration-test'||process.env.R2_BUCKET_NAME!=='mybaby-cloudflare-migration-test-media'||guard?.value!=='mybaby-cloudflare-migration-test')return NextResponse.json({error:'test_only'},{status:403,headers});
 const body=await limitedJson(request,512000) as {keepKeys:string[];dryRun?:boolean};
 if(!Array.isArray(body.keepKeys)||!body.keepKeys.length||body.keepKeys.length>5000||body.keepKeys.some(k=>typeof k!=='string'||!k||k.includes('..')||k.startsWith('/')))return NextResponse.json({error:'invalid_keep_manifest'},{status:400,headers});
 const keep=new Set(body.keepKeys),candidates:string[]=[];let cursor:string|undefined,bytes=0,scanned=0;
 do{const page=await env.MEDIA.list({limit:1000,cursor});for(const object of page.objects){scanned++;if(!keep.has(object.key)){candidates.push(object.key);bytes+=object.size;}}
  cursor=page.truncated?page.cursor:undefined;
  if(scanned>10000)return NextResponse.json({error:'cleanup_scan_limit'},{status:409,headers});
 }while(cursor);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(candidates.slice().sort().join('\n')));
 if(body.dryRun===false)for(let i=0;i<candidates.length;i+=1000)await env.MEDIA.delete(candidates.slice(i,i+1000));
 return NextResponse.json({dryRun:body.dryRun!==false,scanned,candidates:candidates.length,bytes,candidateHash:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')},{headers});
}
