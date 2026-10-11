// Shared multipart arithmetic for large uploads. The server owns the part size so a
// client cannot request a plan that R2 would reject; the client uses the same numbers
// to slice the file and to report byte-accurate progress.
//
// 8 MiB keeps one part inside a single mobile radio burst while staying above the
// 5 MiB S3/R2 minimum that applies to every part except the last one.
export const PART_BYTES=8*1024*1024;
export const MAX_PARTS=10000;
export function partPlan(size:number,partBytes=PART_BYTES):{partBytes:number;partCount:number}{
 if(!Number.isSafeInteger(size)||size<=0)throw new Error('invalid_size');
 if(!Number.isSafeInteger(partBytes)||partBytes<=0)throw new Error('invalid_part_size');
 const partCount=Math.max(1,Math.ceil(size/partBytes));
 if(partCount>MAX_PARTS)throw new Error('too_many_parts');
 // Every part except the last is exactly partBytes, so that is the value the 5 MiB
 // floor applies to. Judging by the average would reject a legal 8 MiB + 1 byte file.
 if(partCount>1&&partBytes<5*1024*1024)throw new Error('invalid_part_size');
 return {partBytes,partCount};
}
// R2/S3 echo ETags quoted in XML but expect them unquoted when completing.
export function normalizeEtag(etag:string|null|undefined):string|null{
 if(typeof etag!=='string')return null;
 const trimmed=etag.trim().replace(/^"|"$/g,'');
 return /^[0-9a-f]{16,64}$/i.test(trimmed)?trimmed.toLowerCase():null;
}
export interface CompletedPart {partNumber:number;etag:string}
// Completion is the one place a lost response is indistinguishable from a lost part,
// so reject anything that is not exactly one monotonic 1..partCount sequence.
export function validPartList(parts:unknown,partCount:number):CompletedPart[]{
 if(!Array.isArray(parts)||parts.length!==partCount)throw new Error('invalid_parts');
 const seen=new Set<number>();
 for(const part of parts as CompletedPart[]){
  const number=part?.partNumber,etag=normalizeEtag(part?.etag);
  if(!Number.isSafeInteger(number)||number<1||number>partCount||seen.has(number)||!etag)throw new Error('invalid_parts');
  seen.add(number);
 }
 return (parts as CompletedPart[]).map(part=>({partNumber:part.partNumber,etag:normalizeEtag(part.etag)!})).sort((a,b)=>a.partNumber-b.partNumber);
}
// Resume state is kept client-side only; it holds identifiers and offsets, never media.
export interface ResumeState {uploadId:string;s3UploadId:string;partBytes:number;size:number;parts:CompletedPart[]}
export function resumeKey(file:{name:string;size:number;lastModified:number}):string{
 return `mybaby:upload:${file.size}:${file.lastModified}:${file.name.slice(0,80)}`;
}
export function resumable(state:unknown,size:number,partBytes:number):state is ResumeState{
 const candidate=state as ResumeState|null;
 return !!candidate&&typeof candidate.uploadId==='string'&&typeof candidate.s3UploadId==='string'&&
  candidate.size===size&&candidate.partBytes===partBytes&&Array.isArray(candidate.parts)&&
  candidate.parts.every(part=>Number.isSafeInteger(part?.partNumber)&&part.partNumber>=1&&!!normalizeEtag(part?.etag));
}
