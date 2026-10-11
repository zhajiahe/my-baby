'use client';
// Per-upload stage timings. Only stage identifiers, durations and byte counts are ever
// emitted: never media bytes, file names, object keys or signed URLs.
export type UploadStage='photo_processing'|'video_preprocessing'|'presign'|'r2_put'|'thumbnail'|'d1_save';
export interface StageRecord {stage:UploadStage;ms:number;bytes?:number;attempts?:number;ok:boolean}
export interface UploadTrace {
 stage:<T>(name:UploadStage,run:()=>Promise<T>,meta?:{bytes?:number})=>Promise<T>;
 report:()=>StageRecord[];
 total:()=>number;
 log:(outcome:'ok'|'failed')=>void;
}
export function createUploadTrace(now:()=>number=()=>Date.now()):UploadTrace {
 const records:StageRecord[]=[],started=now();
 return {
  async stage(name,run,meta){
   const from=now();let ok=true;
   try{return await run();}
   catch(error){ok=false;throw error;}
   finally{records.push({stage:name,ms:Math.round(now()-from),bytes:meta?.bytes,ok});}
  },
  report:()=>records.map(record=>({...record})),
  total:()=>Math.round(now()-started),
  log(outcome){try{console.info(JSON.stringify({event:'upload_timing',outcome,totalMs:Math.round(now()-started),stages:records}));}catch{/* logging must never break an upload */}},
 };
}
// The UI shows the real stage instead of a fixed percentage ladder.
export const stageLabels:Record<UploadStage,string>={
 photo_processing:'处理照片',video_preprocessing:'读取视频信息',presign:'准备上传',
 r2_put:'上传到存储',thumbnail:'生成封面',d1_save:'保存记录',
};
