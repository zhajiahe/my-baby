import { bindings } from '@/lib/db';
import type { R2Range } from '@cloudflare/workers-types/index.ts';
export async function GET(request:Request,{params}:{params:Promise<{key:string[]}>}) {
 const key=(await params).key.join('/');
 if(!/^(uploads|legacy)\//.test(key)||key.includes('..')||key.length>1024)return new Response(null,{status:400});
 const {MEDIA}=await bindings();
 try {
  const raw=request.headers.get('range');let range:R2Range|undefined;
  if(raw){const m=/^bytes=(\d*)-(\d*)$/.exec(raw);if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416});
   range=m[1]?{offset:Number(m[1]),...(m[2]?{length:Number(m[2])-Number(m[1])+1}:{})}:{suffix:Number(m[2])};
   if(Object.values(range).some(v=>!Number.isSafeInteger(v)||v<0)||('length' in range&&range.length===0)||('suffix' in range&&range.suffix===0))return new Response(null,{status:416});}
  const object=await MEDIA.get(key,range?{range}:undefined);if(!object)return new Response(null,{status:404});
  const headers=new Headers({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','ETag':object.httpEtag,
   'Content-Type':object.httpMetadata?.contentType||'application/octet-stream','Content-Security-Policy':"default-src 'none'; sandbox"});
  if(!/^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime))$/.test(headers.get('Content-Type')!))headers.set('Content-Disposition','attachment');
  const body=object.body as unknown as ReadableStream<Uint8Array>;
  if(raw&&object.range&&'offset' in object.range&&'length' in object.range&&typeof object.range.offset==='number'&&typeof object.range.length==='number') {
   headers.set('Content-Range',`bytes ${object.range.offset}-${object.range.offset+object.range.length-1}/${object.size}`);
   headers.set('Content-Length',String(object.range.length));return new Response(body,{status:206,headers});
  }
  headers.set('Content-Length',String(object.size));return new Response(body,{headers});
 }catch{return new Response(null,{status:416});}
}
