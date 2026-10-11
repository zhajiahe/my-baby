import type {R2Bucket} from '@cloudflare/workers-types';
import {UploadError,uploadIdPattern} from './media-upload';
export const mediaTypes:Record<string,string>={jpg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',mp4:'video/mp4',webm:'video/webm'};
export const MAX_MEDIA_BYTES=100*1024*1024;
export function mediaKey(url:unknown):string {
 if(typeof url!=='string'||!/^\/api\/media\/uploads\/[0-9a-f-]+(?:-thumb)?\.(jpg|png|gif|webp|mp4|webm)$/i.test(url))throw new UploadError('invalid_media_url',400);
 const key=url.slice('/api/media/'.length),id=key.slice(8).split('.')[0].replace(/-thumb$/,'');
 if(!uploadIdPattern.test(id))throw new UploadError('invalid_media_key',400);
 return key;
}
// Container signatures are not codec/playability validation; real devices remain a release gate.
export function matchesSignature(bytes:Uint8Array,format:string):boolean {
 const text=(a:number,b:number)=>String.fromCharCode(...bytes.slice(a,b));
 switch(format){
 case 'jpg':return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 case 'png':return bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10';
 case 'gif':return ['GIF87a','GIF89a'].includes(text(0,6));
 case 'webp':return text(0,4)==='RIFF'&&text(8,12)==='WEBP';
 case 'mp4':return text(4,8)==='ftyp'&&['isom','iso2','mp41','mp42','avc1','M4V '].some(brand=>text(8,64).includes(brand))&&!['heic','heix','hevc','hevx','qt  '].some(brand=>text(8,64).includes(brand));
 case 'webm':return bytes.slice(0,4).join(',')==='26,69,223,163';
 default:return false;
 }
}
export async function validateObject(bucket:R2Bucket,url:unknown,expectedFormat?:string):Promise<string>{
 const key=mediaKey(url),format=key.split('.').pop()!;
 if(expectedFormat&&format!==expectedFormat)throw new UploadError('media_format_mismatch',400);
 const object=await bucket.get(key,{range:{offset:0,length:64}});
 if(!object)throw new UploadError('upload_not_complete',409);
 if(!object.size||object.size>MAX_MEDIA_BYTES)throw new UploadError('invalid_actual_size',413);
 if(object.httpMetadata?.contentType!==mediaTypes[format])throw new UploadError('media_content_type_mismatch',415);
 if(!matchesSignature(new Uint8Array(await object.arrayBuffer()),format))throw new UploadError('invalid_media_signature',415);
 return key;
}
export async function validateMedia(bucket:R2Bucket,data:Record<string,any>):Promise<void>{
 if(!['IMAGE','VIDEO'].includes(data.mediaType)||!mediaTypes[data.format]||
 (data.mediaType==='VIDEO')!==mediaTypes[data.format].startsWith('video/'))throw new UploadError('invalid_media_type',400);
 if(!Number.isFinite(new Date(data.date).getTime())||(data.duration!=null&&(!Number.isFinite(data.duration)||data.duration<0)))throw new UploadError('invalid_media_metadata',400);
 const key=await validateObject(bucket,data.url,data.format);
 if(data.uploadId&&( !uploadIdPattern.test(data.uploadId)||key!==`uploads/${data.uploadId}.${data.format}`))throw new UploadError('invalid_upload_reference',400);
 if(data.thumbnailUrl){
  if(data.mediaType!=='VIDEO'||data.thumbnailUrl!==`/api/media/${key.split('.')[0]}-thumb.jpg`)throw new UploadError('invalid_thumbnail_reference',400);
  await validateObject(bucket,data.thumbnailUrl,'jpg');
 }
}
