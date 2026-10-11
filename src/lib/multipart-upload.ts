'use client';
import {partPlan,normalizeEtag,resumeKey,resumable,type CompletedPart,type ResumeState} from './media-multipart';
// R2 multipart upload for large media. It exists so an iPhone upload reports byte-accurate
// progress, retries a failed part instead of the whole file, and resumes after a dropped
// radio. Resume state holds identifiers and offsets only -- never media, keys or URLs.
const ATTEMPTS=3;
const SIGN_BATCH=4;
function sleep(ms:number,signal?:AbortSignal){
 return new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
  const abort=()=>{clearTimeout(timer);reject(new DOMException('上传已取消','AbortError'));};
  signal?.addEventListener('abort',abort,{once:true});
 });
}
// XMLHttpRequest is the only browser API that reports upload progress, so parts go through
// it while the small-file path keeps using fetch.
function putPart(url:string,body:Blob,startedAt:number,signal:AbortSignal,onBytes:(loaded:number)=>void):Promise<string>{
 return new Promise((resolve,reject)=>{
  const request=new XMLHttpRequest(),abort=()=>{request.abort();};
  request.open('PUT',url,true);
  signal.addEventListener('abort',abort,{once:true});
  const finish=()=>signal.removeEventListener('abort',abort);
  request.upload.onprogress=event=>{if(event.lengthComputable)onBytes(startedAt+event.loaded);};
  request.onload=()=>{finish();
   if(request.status>=200&&request.status<300){
    const etag=normalizeEtag(request.getResponseHeader('ETag'));
    if(etag)return resolve(etag);
    return reject(new Error('分片缺少校验标识，请重试'));
   }
   reject(new Error(`分片上传失败 (HTTP ${request.status})`));};
  request.onerror=()=>{finish();reject(new Error('分片上传网络中断，请重试'));};
  request.ontimeout=()=>{finish();reject(new Error('分片上传超时，请重试'));};
  request.onabort=()=>{finish();reject(new DOMException('上传已取消','AbortError'));};
  request.send(body);
 });
}
interface ActionResponse {error?:string;key?:string;publicUrl?:string;format?:string;s3UploadId?:string;partBytes?:number;partCount?:number;parts?:{partNumber:number;url:string}[]}
async function action(body:Record<string,unknown>,signal:AbortSignal):Promise<ActionResponse>{
 const response=await fetch('/api/photos/multipart',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await response.json().catch(()=>({})) as ActionResponse;
 if(!response.ok)throw new Error(data.error||`上传初始化失败 (HTTP ${response.status})`);
 return data;
}
export interface MultipartResult {publicUrl:string;format:string;mediaType:'IMAGE'|'VIDEO';partCount:number}
export async function uploadInParts(file:File,options:{uploadId:string;signal:AbortSignal;onProgress:(fraction:number)=>void}):Promise<MultipartResult>{
 const {uploadId,signal,onProgress}=options,storageKey=resumeKey(file);
 const readState=():ResumeState|null=>{try{const raw=window.localStorage.getItem(storageKey);return raw?JSON.parse(raw) as ResumeState:null;}catch{return null;}};
 const writeState=(state:ResumeState|null)=>{try{state?window.localStorage.setItem(storageKey,JSON.stringify(state)):window.localStorage.removeItem(storageKey);}catch{/* private mode: resume is best effort */}};
 let state:ResumeState|null=null,created:ActionResponse|null=null;
 const cached=readState();
 // A cached plan is only reusable when it still describes this exact file.
 if(cached&&resumable(cached,file.size,partPlan(file.size).partBytes)&&(!cached.parts.length||cached.uploadId===uploadId))state=cached;
 if(state){created={s3UploadId:state.s3UploadId};}
 else{created=await action({action:'create',uploadId,contentType:file.type,size:file.size},signal);
  state={uploadId,s3UploadId:created.s3UploadId!,partBytes:created.partBytes!,size:file.size,parts:[]};writeState(state);}
 const {partBytes,partCount}=partPlan(file.size,state.partBytes);
 const done=new Map<number,string>(state.parts.map(part=>[part.partNumber,part.etag]));
 const report=()=>onProgress(Math.min(1,[...done.keys()].reduce((total,number)=>total+Math.min(partBytes,file.size-(number-1)*partBytes),0)/file.size));
 report();
 const pending=Array.from({length:partCount},(_,index)=>index+1).filter(number=>!done.has(number));
 try{
  for(let offset=0;offset<pending.length;offset+=SIGN_BATCH){
   const batch=pending.slice(offset,offset+SIGN_BATCH);
   const signed=await action({action:'sign',uploadId,contentType:file.type,size:file.size,s3UploadId:state.s3UploadId,partNumbers:batch},signal);
   const urls=new Map((signed.parts||[]).map(part=>[part.partNumber,part.url]));
   for(const partNumber of batch){
    const url=urls.get(partNumber);
    if(!url)throw new Error('分片地址签发失败，请重试');
    const start=(partNumber-1)*partBytes,blob=file.slice(start,Math.min(start+partBytes,file.size));
    let lastError:unknown;
    for(let attempt=1;attempt<=ATTEMPTS;attempt++){
     try{
      const etag=await putPart(url,blob,(partNumber-1)*partBytes,signal,loaded=>onProgress(Math.min(1,(loaded+[...done.entries()].reduce((total,[number])=>number===partNumber?0:total+Math.min(partBytes,file.size-(number-1)*partBytes),0))/file.size)));
      done.set(partNumber,etag);state!.parts=[...done].map(([number,value])=>({partNumber:number,etag:value}));
      writeState(state);report();lastError=undefined;break;
     }catch(error){
      if(error instanceof DOMException&&error.name==='AbortError')throw error;
      lastError=error;
      if(attempt<ATTEMPTS)await sleep(500*2**(attempt-1),signal);
     }
    }
    if(lastError)throw lastError;
   }
  }
  const parts:CompletedPart[]=[...done].map(([partNumber,etag])=>({partNumber,etag}));
  const completed=await action({action:'complete',uploadId,contentType:file.type,size:file.size,s3UploadId:state.s3UploadId,parts},signal);
  writeState(null);
  onProgress(1);
  return {publicUrl:completed.publicUrl||`/api/media/${completed.key}`,format:completed.format||'',mediaType:file.type.startsWith('video/')?'VIDEO':'IMAGE',partCount};
 }catch(error){
  // Only an explicit user abort discards resume state; a network failure keeps it.
  if(error instanceof DOMException&&error.name==='AbortError'){writeState(null);
   await action({action:'abort',uploadId,s3UploadId:state.s3UploadId},AbortSignal.timeout(10000)).catch(()=>undefined);}
  throw error;
 }
}
export function hasResumeState(file:File):boolean{
 try{return !!window.localStorage.getItem(resumeKey(file));}catch{return false;}
}
