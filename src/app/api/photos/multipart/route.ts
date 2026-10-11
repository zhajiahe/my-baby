import { NextResponse } from 'next/server';
import { S3Client,CreateMultipartUploadCommand,UploadPartCommand,CompleteMultipartUploadCommand,AbortMultipartUploadCommand,HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { limitedJson } from '@/lib/auth';
import { uploadIdPattern } from '@/lib/media-upload';
import { MAX_MEDIA_BYTES } from '@/lib/media-validation';
import { PART_BYTES,partPlan,validPartList } from '@/lib/media-multipart';
// Multipart exists so a long iPhone upload reports real byte progress, survives a
// dropped radio and can resume instead of restarting. The object key is always derived
// from the server-validated upload id; the client never names its own key.
const types:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp','image/heic':'heic',
 'video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov'};
const headers={'Cache-Control':'private, no-store'};
const fail=(error:string,status=400)=>NextResponse.json({error},{status,headers});
function client(){return new S3Client({region:'auto',endpoint:`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
 credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID!,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY!,sessionToken:process.env.R2_SESSION_TOKEN}});}
export async function POST(request:Request) {
 try {
  const data=await limitedJson(request) as {action?:string;uploadId?:string;contentType?:string;size?:number;
   s3UploadId?:string;partNumbers?:number[];parts?:{partNumber:number;etag:string}[]};
  if(typeof data.uploadId!=='string'||!uploadIdPattern.test(data.uploadId))return fail('invalid_upload_id');
  const format=data.contentType?types[data.contentType]:undefined;
  if(data.action!=='abort'&&!format)return fail('unsupported_media_type',415);
  const key=`uploads/${data.uploadId}.${format}`,s3=client();
  const bucket=process.env.R2_BUCKET_NAME!;
  switch(data.action){
   case 'create':{
    if(!Number.isSafeInteger(data.size)||!data.size||data.size<=0||data.size>MAX_MEDIA_BYTES)return fail('invalid_size');
    const plan=partPlan(data.size);
    const created=await s3.send(new CreateMultipartUploadCommand({Bucket:bucket,Key:key,ContentType:data.contentType}));
    if(!created.UploadId)return fail('multipart_create_failed',500);
    return NextResponse.json({success:true,key,publicUrl:`/api/media/${key}`,format,mediaType:data.contentType!.startsWith('video/')?'VIDEO':'IMAGE',
     s3UploadId:created.UploadId,partBytes:plan.partBytes,partCount:plan.partCount}, {headers});
   }
   case 'sign':{
    if(typeof data.s3UploadId!=='string'||!data.s3UploadId)return fail('invalid_multipart_id');
    if(!Number.isSafeInteger(data.size)||!data.size||data.size<=0||data.size>MAX_MEDIA_BYTES)return fail('invalid_size');
    const {partCount}=partPlan(data.size);
    if(!Array.isArray(data.partNumbers)||!data.partNumbers.length||data.partNumbers.length>partCount)return fail('invalid_part_numbers');
    if(data.partNumbers.some(n=>!Number.isSafeInteger(n)||n<1||n>partCount))return fail('invalid_part_numbers');
    const urls=await Promise.all(data.partNumbers.map(async partNumber=>({partNumber,
     url:await getSignedUrl(s3,new UploadPartCommand({Bucket:bucket,Key:key,UploadId:data.s3UploadId,PartNumber:partNumber}),{expiresIn:3600})})));
    return NextResponse.json({success:true,parts:urls}, {headers});
   }
   case 'complete':{
    if(typeof data.s3UploadId!=='string'||!data.s3UploadId)return fail('invalid_multipart_id');
    if(!Number.isSafeInteger(data.size)||!data.size||data.size<=0||data.size>MAX_MEDIA_BYTES)return fail('invalid_size');
    let parts;
    try{parts=validPartList(data.parts,partPlan(data.size).partCount);}catch{return fail('invalid_parts');}
    try{
     await s3.send(new CompleteMultipartUploadCommand({Bucket:bucket,Key:key,UploadId:data.s3UploadId,
      MultipartUpload:{Parts:parts.map(part=>({PartNumber:part.partNumber,ETag:`"${part.etag}"`}))}}));
    }catch{
     // A repeated completion after a dropped response is a success, not a failure.
     const head=await s3.send(new HeadObjectCommand({Bucket:bucket,Key:key})).catch(()=>null);
     if(!head)return fail('multipart_complete_failed',502);
    }
    return NextResponse.json({success:true,key,publicUrl:`/api/media/${key}`,format}, {headers});
   }
   case 'abort':{
    if(typeof data.s3UploadId!=='string'||!data.s3UploadId)return fail('invalid_multipart_id');
    await s3.send(new AbortMultipartUploadCommand({Bucket:bucket,Key:key,UploadId:data.s3UploadId})).catch(()=>undefined);
    return NextResponse.json({success:true}, {headers});
   }
   default:return fail('invalid_action');
  }
 }catch{return NextResponse.json({error:'multipart_failed'},{status:500,headers});}
}
