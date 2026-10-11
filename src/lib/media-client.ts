'use client';
// Browser-only processing. No Sharp, native FFmpeg, shell, filesystem or VPS.
export function normalizeMediaFile(file:File):File{
 if(file.type)return file;
 const ext=file.name.split('.').pop()?.toLowerCase();
 const types:Record<string,string>={heic:'image/heic',heif:'image/heif',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',avif:'image/avif',mp4:'video/mp4',m4v:'video/mp4',webm:'video/webm',mov:'video/quicktime'};
 return ext&&types[ext]?new File([file],file.name,{type:types[ext]}):file;
}
export async function browserImage(file:File):Promise<File>{
 if(/\.(heic|heif)$/i.test(file.name)||file.type.includes('heic')||file.type.includes('heif')){
  const {default:convert}=await import('heic2any');
  const result=await convert({blob:file,toType:'image/jpeg',quality:0.85});
  return new File([Array.isArray(result)?result[0]:result],file.name.replace(/\.[^.]+$/,'.jpg'),{type:'image/jpeg'});
 }
 if(['image/jpeg','image/png','image/gif','image/webp'].includes(file.type))return file;
 const bitmap=await createImageBitmap(file),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
 const ctx=canvas.getContext('2d');if(!ctx){bitmap.close();throw new Error('图片转换不可用');}
 ctx.drawImage(bitmap,0,0);bitmap.close();
 const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('图片转换失败')),'image/jpeg',0.85));
 return new File([blob],file.name.replace(/\.[^.]+$/,'.jpg'),{type:'image/jpeg'});
}
let engine:Promise<import('@ffmpeg/ffmpeg').FFmpeg>|undefined;
let tail:Promise<unknown>=Promise.resolve();
async function ffmpeg(){
 if(!crossOriginIsolated)throw new Error('浏览器未启用安全隔离，请刷新页面后重试');
 return engine??= (async()=>{
  const {FFmpeg}=await import('@ffmpeg/ffmpeg'),worker=new FFmpeg();
  const response=await fetch('/runtime/ffmpeg-core.wasm.gz');if(!response.ok||!response.body)throw new Error('视频转换组件加载失败');
  const stream=response.body.pipeThrough(new DecompressionStream('gzip'));
  const wasm=URL.createObjectURL(new Blob([await new Response(stream).arrayBuffer()],{type:'application/wasm'}));
  try{await worker.load({coreURL:new URL('/runtime/ffmpeg-core.js',location.origin).href,wasmURL:wasm},{signal:AbortSignal.timeout(60000)});return worker;}
  catch(error){worker.terminate();engine=undefined;throw error;}finally{URL.revokeObjectURL(wasm);}
 })();
}
export async function browserVideo(file:File):Promise<Blob>{
 if(file.type==='video/mp4'&&/\.mp4$/i.test(file.name))return file;
 // Keep the existing browser/R2 passthrough flow safe by default. WASM
 // transcoding is opt-in until its cross-browser E2E acceptance is complete.
 if(process.env.NEXT_PUBLIC_MEDIA_WASM_ENABLED!=='true'){
  if(file.type==='video/webm')return file;
  throw new Error('此视频请先在设备上导出 MP4；浏览器转码尚未完成兼容性验收');
 }
 if(file.size>200*1024*1024)throw new Error('需转换的视频超过 200MB，请先在设备上导出 MP4');
 const job=async()=>{
  const worker=await ffmpeg(),id=crypto.randomUUID(),input=`${id}-input`,output=`${id}.mp4`;
  try{
   await worker.writeFile(input,new Uint8Array(await file.arrayBuffer()));
   const code=await worker.exec(['-i',input,'-c:v','libx264','-preset','ultrafast','-crf','24','-c:a','aac','-movflags','+faststart',output],120000);
   if(code!==0)throw new Error('视频转换失败，请在设备上导出 MP4 后重试');
   const data=await worker.readFile(output);if(typeof data==='string')throw new Error('视频转换失败');
   return new Blob([new Uint8Array(data)],{type:'video/mp4'});
  }finally{await worker.deleteFile(input).catch(()=>{});await worker.deleteFile(output).catch(()=>{});}
 };
 const result=tail.then(job,job);tail=result.catch(()=>{});return result;
}
