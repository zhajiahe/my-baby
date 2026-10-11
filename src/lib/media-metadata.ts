'use client';
export interface VideoMetadata {thumbnail:Blob;duration:number|null;width:number;height:number}
// A single completion path keeps the deadline active until JPEG encoding ends.
// The offscreen attached video and loadeddata event are important on Safari.
export function videoMetadata(file:Blob,timeoutMs=15000):Promise<VideoMetadata>{
 return new Promise((resolve,reject)=>{
  const video=document.createElement('video'),url=URL.createObjectURL(file);
  let ended=false,capturing=false,seeking=false;
  video.preload='auto';video.muted=true;video.playsInline=true;
  video.style.cssText='position:fixed;left:-9999px;width:1px;height:1px;pointer-events:none';
  const cleanup=()=>{clearTimeout(timer);video.onloadedmetadata=video.onloadeddata=video.onseeked=video.onerror=null;
   video.removeAttribute('src');video.load();video.remove();URL.revokeObjectURL(url);};
  const fail=(message:string)=>{if(ended)return;ended=true;cleanup();reject(new Error(message));};
  const timer=setTimeout(()=>fail('视频解码超时，不能确认兼容性；请导出 H.264 MP4 后重试'),timeoutMs);
  const capture=()=>{
   if(ended||capturing||seeking||video.readyState<2||!video.videoWidth||!video.videoHeight)return;
   capturing=true;
   try{
    const canvas=document.createElement('canvas');canvas.width=Math.min(320,video.videoWidth);
    canvas.height=Math.max(1,Math.round(video.videoHeight/video.videoWidth*canvas.width));
    const ctx=canvas.getContext('2d');if(!ctx)return fail('视频缩略图生成失败');ctx.drawImage(video,0,0,canvas.width,canvas.height);
    const duration=Number.isFinite(video.duration)&&video.duration>0?Math.round(video.duration):null;
    const width=video.videoWidth,height=video.videoHeight;
    canvas.toBlob(thumbnail=>{if(ended)return;if(!thumbnail)return fail('视频缩略图编码失败');
     ended=true;cleanup();resolve({thumbnail,duration,width,height});},'image/jpeg',0.8);
   }catch{fail('视频格式不兼容，无法生成缩略图；请导出 H.264 MP4');}
  };
  video.onloadedmetadata=()=>{
   if(Number.isFinite(video.duration)&&video.duration>0){const time=Math.min(1,video.duration/2);
    if(time>0){seeking=true;try{video.currentTime=time;}catch{seeking=false;capture();}}}
  };
  video.onloadeddata=capture;video.onseeked=()=>{seeking=false;capture();};
  video.onerror=()=>fail('视频格式或编码不兼容；MOV/HEVC 尚未通过验收，请导出 H.264 MP4');
  document.body.appendChild(video);video.src=url;video.load();
 });
}
export async function mediaFetch(input:RequestInfo|URL,init:RequestInit={},timeoutMs=120000){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{return await fetch(input,{...init,signal:controller.signal});}
 catch(error){if(controller.signal.aborted)throw new Error('网络请求超时，请重试');throw error;}
 finally{clearTimeout(timer);}
}
