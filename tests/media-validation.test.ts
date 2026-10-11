import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {R2Bucket} from '@cloudflare/workers-types';
import {mediaKey,validateMedia,validateObject,MAX_MEDIA_BYTES} from '../src/lib/media-validation';
const id='12345678-1234-4234-8234-123456789abc',url=`/api/media/uploads/${id}.png`;
const png=Uint8Array.from([137,80,78,71,13,10,26,10]);
function bucket(size=8,type='image/png',bytes=png):R2Bucket{return {get:async()=>({size,httpMetadata:{contentType:type},arrayBuffer:async()=>bytes.buffer})} as unknown as R2Bucket;}
test('canonical private URL only, including non-idempotent callers',()=>{
 assert.equal(mediaKey(url),`uploads/${id}.png`);
 for(const bad of ['https://evil.test/a.png','/api/media/legacy/a.png',url+'?x=1',url.replace('uploads/','uploads/../'),url.replace(id,'bad')])assert.throws(()=>mediaKey(bad));
});
test('object existence, actual size, MIME and file signature enforced',async()=>{
 await validateObject(bucket(),url,'png');
 await assert.rejects(validateObject({get:async()=>null} as unknown as R2Bucket,url),/upload_not_complete/);
 for(const size of [0,MAX_MEDIA_BYTES+1])await assert.rejects(validateObject(bucket(size),url),/invalid_actual_size/);
 await assert.rejects(validateObject(bucket(8,'image/jpeg'),url),/media_content_type_mismatch/);
 await assert.rejects(validateObject(bucket(8,'image/png',new Uint8Array([60,104,116,109,108])),url),/invalid_media_signature/);
});
test('type, format, date, duration and thumbnail relation cannot be forged',async()=>{
 const data={url,format:'png',mediaType:'IMAGE',date:'2025-01-01',uploadId:id};
 await validateMedia(bucket(),data);
 for(const invalid of [{mediaType:'VIDEO'},{format:'jpg'},{date:'bad'},{duration:Infinity},{uploadId:crypto.randomUUID()},{thumbnailUrl:url}])await assert.rejects(validateMedia(bucket(),{...data,...invalid}));
});
