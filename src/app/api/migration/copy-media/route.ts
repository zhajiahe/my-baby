import {createHash} from 'node:crypto';
import {bindings,database} from '@/lib/db';
import {equalSecret,limitedJson} from '@/lib/auth';
async function digest(stream:ReadableStream<Uint8Array>){const hash=createHash('sha256'),reader=stream.getReader();
 try{for(;;){const {done,value}=await reader.read();if(done)break;hash.update(value);}return hash.digest('hex');}finally{reader.releaseLock();}}
export async function POST(request:Request){
 const env=await bindings(),token=env.MIGRATION_TOKEN;
 if(!token||token.length<32||!equalSecret(request.headers.get('authorization')||'',`Bearer ${token}`))return new Response(null,{status:401});
 const db=await database();const guard=await db.prepare("SELECT value FROM deployment_guard WHERE name='environment'").first<{value:string}>();
 if(guard?.value!=='mybaby-cloudflare-migration-test'||!env.SOURCE_MEDIA)return new Response(null,{status:503});
 try{
  const {key}=await limitedJson(request) as {key:string};
  if(typeof key!=='string'||!key||key.length>1024||key.includes('..')||key.startsWith('/'))return new Response(null,{status:400});
  // SOURCE_MEDIA is used exclusively for GET. Never mutate or delete source.
  const source=await env.SOURCE_MEDIA.get(key);if(!source)return new Response(null,{status:404});
  // Hash inline under upload backpressure. tee() could buffer an entire large
  // video when hashing outruns the upload; FixedLengthStream also preserves
  // the content length required by R2.put.
  const hash=createHash('sha256'),fixed=new FixedLengthStream(source.size);
  const upload=(source.body as unknown as ReadableStream<Uint8Array>).pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
   transform(chunk,controller){hash.update(chunk);controller.enqueue(chunk);}
  })).pipeTo(fixed.writable);
  await Promise.all([upload,env.MEDIA.put(`legacy/${key}`,fixed.readable as unknown as Parameters<typeof env.MEDIA.put>[1],{httpMetadata:source.httpMetadata})]);
  const sourceHash=hash.digest('hex');
  const target=await env.MEDIA.get(`legacy/${key}`);if(!target)return new Response(null,{status:500});
  const targetHash=await digest(target.body as unknown as ReadableStream<Uint8Array>);
  if(sourceHash!==targetHash||source.size!==target.size)return new Response(null,{status:409});
  return Response.json({verified:true,bytes:source.size,sha256:sourceHash},{headers:{'Cache-Control':'no-store'}});
 }catch{return new Response(null,{status:500});}
}
