'use client';
import {compatibleMp4,videoFilters} from './video-container';
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
async function ffmpeg(signal:AbortSignal){
 if(!crossOriginIsolated)throw new Error('浏览器未启用安全隔离，请刷新页面后重试');
 return engine??= (async()=>{
  const {FFmpeg}=await import('@ffmpeg/ffmpeg'),worker=new FFmpeg();
  let wasm:string|undefined;
  try{
   const response=await fetch('/runtime/ffmpeg-core.wasm.gz',{signal});if(!response.ok||!response.body)throw new Error('视频转换组件加载失败');
   const stream=response.body.pipeThrough(new DecompressionStream('gzip'));
   wasm=URL.createObjectURL(new Blob([await new Response(stream).arrayBuffer()],{type:'application/wasm'}));
   await worker.load({classWorkerURL:new URL('/runtime/ffmpeg/worker.js',location.origin).href,
    coreURL:new URL('/runtime/ffmpeg-core.js',location.origin).href,wasmURL:wasm},{signal});return worker;
  }catch(error){worker.terminate();engine=undefined;throw error;}
  finally{if(wasm)URL.revokeObjectURL(wasm);}
 })();
}
export interface VideoOptions {signal?:AbortSignal;onProgress?:(progress:number)=>void;}
export async function browserVideo(file:File,options:VideoOptions={}):Promise<Blob>{
 if(options.signal?.aborted)throw new DOMException('视频处理已取消','AbortError');
 if(await compatibleMp4(file)||file.type==='video/webm')return file;
 if(process.env.NEXT_PUBLIC_MEDIA_WASM_ENABLED==='false')throw new Error('视频转换未开启');
 if(file.size>200*1024*1024)throw new Error('需转换的视频超过 200MB');
 const job=async()=>{
  if(options.signal?.aborted)throw new DOMException('视频处理已取消','AbortError');
  const controller=new AbortController(),signal=controller.signal;
  const abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});
  // Outer deadline also covers loading/probing/file operations, not just exec().
  const timeout=setTimeout(abort,210000);
  const id=crypto.randomUUID(),input=`${id}-input`,output=`${id}.mp4`,probe=`${id}.json`;
  let worker:import('@ffmpeg/ffmpeg').FFmpeg|undefined,complete=false;
  const progress=({progress}:{progress:number})=>options.onProgress?.(Math.max(2,Math.min(9,2+Math.round(progress*7))));
  try{
   options.onProgress?.(1);worker=await ffmpeg(signal);worker.on('progress',progress);
   await worker.writeFile(input,new Uint8Array(await file.arrayBuffer()),{signal});
   const probeCode=await worker.ffprobe(['-v','error','-show_entries','stream=codec_type,color_transfer','-of','json',input,'-o',probe],30000,{signal});
   // core 0.12.10 leaves ret=-1 after successful ffprobe; validate its JSON output too.
   if(probeCode>0)throw new Error('无法读取视频，请检查原片是否完整');
   const metadata=await worker.readFile(probe,'utf8',{signal});
   if(typeof metadata!=='string')throw new Error('无法读取视频信息');
   const streams=(JSON.parse(metadata) as {streams?:{codec_type?:string;color_transfer?:string}[]}).streams;
   const video=streams?.find(s=>s.codec_type==='video');if(!video)throw new Error('文件没有可用视频轨道');
   const hdr=['arib-std-b67','smpte2084'].includes(video.color_transfer||'');
   const code=await worker.exec(['-i',input,'-map','0:v:0','-map','0:a:0?','-sn','-dn','-map_metadata','-1',
    '-vf',videoFilters(hdr),'-c:v','libx264','-preset','ultrafast','-crf','24','-profile:v','main','-level:v','4.1',
    '-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-metadata:s:v:0','rotate=0','-movflags','+faststart',output],120000,{signal});
   if(code!==0)throw new Error('视频转换失败或超时，请重试较短的视频');
   const data=await worker.readFile(output,'binary',{signal});if(typeof data==='string'||!data.length)throw new Error('视频转换失败');
   complete=true;return new Blob([new Uint8Array(data)],{type:'video/mp4'});
  }catch(error){
   worker?.terminate();engine=undefined;
   if(signal.aborted)throw new Error(options.signal?.aborted?'视频处理已取消':'视频转换超时，请重试较短的视频');
   throw error instanceof Error?error:new Error('视频转换失败，请检查格式或重试');
  }finally{
   clearTimeout(timeout);options.signal?.removeEventListener('abort',abort);worker?.off('progress',progress);
   if(complete&&worker)for(const path of [input,output,probe])await worker.deleteFile(path).catch(()=>{});
  }
 };
 const result=tail.then(job,job);tail=result.catch(()=>{});return result;
}
