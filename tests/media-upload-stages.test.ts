import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {R2Bucket} from '@cloudflare/workers-types';
import {PART_BYTES,partPlan,normalizeEtag,validPartList,resumable,resumeKey} from '../src/lib/media-multipart';
import {matchesSignature,mediaKey,validateMedia} from '../src/lib/media-validation';
import {createUploadTrace,stageLabels} from '../src/lib/upload-timing';
const id='12345678-1234-4234-8234-123456789abc';
function ftyp(brand:string){return Uint8Array.from([0,0,0,0x20,0x66,0x74,0x79,0x70,...brand.split('').map(c=>c.charCodeAt(0)),0,0,0,0]);}
function bucket(objects:Record<string,{type:string;bytes:Uint8Array;size?:number}>):R2Bucket{
 return {get:async(key:string)=>{const object=objects[key];if(!object)return null;
  return {size:object.size??1024,httpMetadata:{contentType:object.type},arrayBuffer:async()=>object.bytes.buffer};}} as unknown as R2Bucket;
}
test('part plan stays inside R2 limits for every accepted size',()=>{
 assert.deepEqual(partPlan(1),{partBytes:PART_BYTES,partCount:1});
 assert.deepEqual(partPlan(PART_BYTES),{partBytes:PART_BYTES,partCount:1});
 assert.equal(partPlan(PART_BYTES+1).partCount,2);
 assert.equal(partPlan(100*1024*1024).partCount,13);
 for(const bad of [0,-1,1.5,NaN,Infinity])assert.throws(()=>partPlan(bad));
 // A plan whose parts would fall under the 5 MiB floor is refused rather than silently split.
 assert.throws(()=>partPlan(10*1024*1024,1024*1024));
});
test('etags are normalized and anything unverifiable is rejected',()=>{
 assert.equal(normalizeEtag('"abcdef0123456789"'),'abcdef0123456789');
 assert.equal(normalizeEtag(' ABCDEF0123456789 '),'abcdef0123456789');
 for(const bad of [null,undefined,'','ETAG','abc','z'.repeat(20)])assert.equal(normalizeEtag(bad as string),null);
});
test('completion requires exactly one monotonic 1..partCount sequence',()=>{
 const parts=[{partNumber:1,etag:'"0123456789abcdef"'},{partNumber:2,etag:'"fedcba9876543210"'}];
 assert.deepEqual(validPartList(parts,2).map(p=>p.partNumber),[1,2]);
 assert.deepEqual(validPartList([...parts].reverse(),2).map(p=>p.partNumber),[1,2]);
 for(const bad of [[],[parts[0]],[parts[0],parts[0]],[{partNumber:0,etag:'"0123456789abcdef"'},parts[1]],
  [{partNumber:1,etag:'"0123456789abcdef"'},{partNumber:3,etag:'"fedcba9876543210"'}],
  [{partNumber:1,etag:'nope'},{partNumber:2,etag:'"fedcba9876543210"'}],
  [{partNumber:1,etag:'"'+'a'.repeat(70)+'"'},{partNumber:2,etag:'"fedcba9876543210"'}],
  [parts[0],parts[1],parts[1]]])assert.throws(()=>validPartList(bad,2));
});
test('resume state is only reused when it describes the same file and plan',()=>{
 const state={uploadId:id,s3UploadId:'s3-id',partBytes:PART_BYTES,size:20*1024*1024,parts:[{partNumber:1,etag:'0123456789abcdef'}]};
 assert.equal(resumable(state,20*1024*1024,PART_BYTES),true);
 assert.equal(resumable(state,21*1024*1024,PART_BYTES),false);
 assert.equal(resumable({...state,parts:[{partNumber:1,etag:'bad'}]},20*1024*1024,PART_BYTES),false);
 assert.equal(resumable(null,20*1024*1024,PART_BYTES),false);
 // The resume key identifies a file without containing its media or any object key.
 const key=resumeKey({name:'IMG_0001.MOV',size:20,lastModified:5});
 assert.match(key,/^mybaby:upload:20:5:/);
});
test('HEIC and QuickTime are accepted containers, and neither counts as MP4',()=>{
 for(const brand of ['heic','heix','hevc','hevx','mif1','msf1'])assert.equal(matchesSignature(ftyp(brand),'heic'),true,brand);
 assert.equal(matchesSignature(ftyp('heic'),'mov'),false);
 assert.equal(matchesSignature(ftyp('qt  '),'mov'),true);
 assert.equal(matchesSignature(ftyp('qt  '),'heic'),false);
 assert.equal(matchesSignature(ftyp('qt  '),'mp4'),false);
 assert.equal(matchesSignature(ftyp('heic'),'mp4'),false);
 assert.equal(matchesSignature(ftyp('isom'),'mp4'),true);
 assert.equal(matchesSignature(ftyp('isom'),'mov'),false);
});
test('archive URLs cover the original HEIC and MOV keys',()=>{
 assert.equal(mediaKey(`/api/media/uploads/${id}.heic`),`uploads/${id}.heic`);
 assert.equal(mediaKey(`/api/media/uploads/${id}.mov`),`uploads/${id}.mov`);
 assert.equal(mediaKey(`/api/media/uploads/${id}-thumb.jpg`),`uploads/${id}-thumb.jpg`);
 for(const bad of [`/api/media/uploads/${id}.avi`,`/api/media/uploads/${id}.heif`,`/api/media/uploads/${id}.exe`])assert.throws(()=>mediaKey(bad));
});
test('a HEIC preview is allowed as a thumbnail, and only for HEIC images',async()=>{
 const heic=ftyp('heic'),jpg=Uint8Array.from([255,216,255,0]);
 const thumbnail={type:'image/jpeg',bytes:jpg};
 const media=bucket({[`uploads/${id}.heic`]:{type:'image/heic',bytes:heic},[`uploads/${id}-thumb.jpg`]:thumbnail});
 await assert.doesNotReject(()=>validateMedia(media,{mediaType:'IMAGE',format:'heic',date:new Date().toISOString(),url:`/api/media/uploads/${id}.heic`,thumbnailUrl:`/api/media/uploads/${id}-thumb.jpg`}));
 // Only the derived key is accepted, never a caller-chosen object.
 await assert.rejects(()=>validateMedia(media,{mediaType:'IMAGE',format:'heic',date:new Date().toISOString(),url:`/api/media/uploads/${id}.heic`,thumbnailUrl:`/api/media/uploads/${id}.jpg`}));
 const png=bucket({[`uploads/${id}.png`]:{type:'image/png',bytes:Uint8Array.from([137,80,78,71,13,10,26,10])},[`uploads/${id}-thumb.jpg`]:thumbnail});
 await assert.rejects(()=>validateMedia(png,{mediaType:'IMAGE',format:'png',date:new Date().toISOString(),url:`/api/media/uploads/${id}.png`,thumbnailUrl:`/api/media/uploads/${id}-thumb.jpg`}));
 // A video cover still resolves through the same object check.
 const mov=bucket({[`uploads/${id}.mov`]:{type:'video/quicktime',bytes:ftyp('qt  ')},[`uploads/${id}-thumb.jpg`]:thumbnail});
 await assert.doesNotReject(()=>validateMedia(mov,{mediaType:'VIDEO',format:'mov',date:new Date().toISOString(),duration:12,url:`/api/media/uploads/${id}.mov`,thumbnailUrl:`/api/media/uploads/${id}-thumb.jpg`}));
});
test('stage timings record durations without leaking media, keys or signed URLs',async()=>{
 const clock=[0];const trace=createUploadTrace(()=>clock[0]);
 await assert.rejects(()=>trace.stage('presign',async()=>{clock[0]=1200;throw new Error('boom');}));
 await trace.stage('r2_put',async()=>{clock[0]=5000;return 'ignored';},{bytes:8*1024*1024});
 const records=trace.report();
 assert.deepEqual(records,[{stage:'presign',ms:1200,bytes:undefined,ok:false},{stage:'r2_put',ms:3800,bytes:8388608,ok:true}]);
 assert.equal(trace.total(),5000);
 const lines:string[]=[];const original=console.info;
 console.info=(line?:unknown)=>{lines.push(String(line));};
 try{trace.log('ok');}finally{console.info=original;}
 assert.equal(lines.length,1);
 const parsed=JSON.parse(lines[0]);
 assert.equal(parsed.event,'upload_timing');
 assert.deepEqual(Object.keys(parsed).sort(),['event','outcome','stages','totalMs']);
 const allowed=new Set(['bytes','ms','ok','stage']);
 for(const record of parsed.stages)for(const key of Object.keys(record))assert.ok(allowed.has(key),key);
 // The emitted line must not carry a URL, an object key or the media itself.
 for(const forbidden of ['X-Amz','http','uploads/','/api/media','secret'])assert.equal(lines[0].includes(forbidden),false,forbidden);
 assert.ok(stageLabels.r2_put&&stageLabels.d1_save);
});
