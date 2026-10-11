'use client';
import {useEffect,useRef,useState} from 'react';

export default function PrivateVideo({src,poster,onDimensions}:{src:string;poster?:string;onDimensions?:(width:number,height:number)=>void}){
 const videoRef=useRef<HTMLVideoElement>(null),deadline=useRef<ReturnType<typeof setTimeout>|null>(null),resume=useRef(0);
 const [error,setError]=useState<string|null>(null);
 const clear=()=>{if(deadline.current!==null)clearTimeout(deadline.current);deadline.current=null;};
 const wait=()=>{
  clear();deadline.current=setTimeout(()=>{const video=videoRef.current;
   if(video){resume.current=Number.isFinite(video.currentTime)?video.currentTime:0;setError('视频加载较慢或连接中断，请重试');}
  },20000);
 };
 useEffect(()=>()=>{if(deadline.current!==null)clearTimeout(deadline.current);},[]);
 const retry=()=>{
  const video=videoRef.current;if(!video)return;
  clear();setError(null);video.load();
  // Call play inside the user gesture, including on Safari; don't wait for a
  // later event and lose activation. Restore the seek point after metadata.
  void video.play().catch(()=>{/* Native controls remain available if autoplay is denied. */});
 };
 return <div className="relative w-full h-full flex items-center justify-center">
  <video ref={videoRef} src={src} poster={poster} controls playsInline preload="metadata"
   className="w-full h-full object-contain" style={{maxHeight:'70vh'}}
   onLoadStart={wait} onWaiting={wait}
   onStalled={()=>{const video=videoRef.current;if(video&&(!video.paused||video.seeking))wait();}}
   onLoadedMetadata={()=>{
    clear();const video=videoRef.current;if(!video)return;
    if(video.videoWidth&&video.videoHeight)onDimensions?.(video.videoWidth,video.videoHeight);
    if(resume.current>0&&Number.isFinite(video.duration)){video.currentTime=Math.min(resume.current,Math.max(0,video.duration-0.1));resume.current=0;}
   }}
   onCanPlay={clear} onSeeked={clear} onPlaying={()=>{clear();setError(null);}}
   onError={()=>{clear();const video=videoRef.current;resume.current=video&&Number.isFinite(video.currentTime)?video.currentTime:0;setError('视频加载失败，请重试');}}
  >当前浏览器不支持视频播放。</video>
  {error&&<div role="alert" className="absolute inset-0 bg-slate-900/85 text-white flex flex-col items-center justify-center gap-3 p-4 text-center">
   <p>{error}</p><button onClick={retry} className="btn-secondary">重试播放</button>
  </div>}
 </div>;
}
