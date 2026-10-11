import { NextResponse } from 'next/server';
import { S3Client,PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { limitedJson } from '@/lib/auth';
import { uploadIdPattern } from '@/lib/media-upload';
const types:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp',
 'video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov'};
export async function POST(request:Request) {
 try {
  const data=await limitedJson(request) as {contentType:string;size?:number;uploadId?:string};
  const format=types[data.contentType]; if(!format)return NextResponse.json({error:'请先在浏览器转换为 JPEG 或兼容视频格式'}, {status:415});
  if(data.size!==undefined&&(!Number.isSafeInteger(data.size)||data.size<=0||data.size>1024*1024*1024))return NextResponse.json({error:'invalid_size'},{status:400});
  const client=new S3Client({region:'auto',endpoint:`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
   credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID!,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY!,sessionToken:process.env.R2_SESSION_TOKEN}});
  if(data.uploadId!==undefined&&!uploadIdPattern.test(data.uploadId))return NextResponse.json({error:'invalid_upload_id'},{status:400});
  const id=data.uploadId??crypto.randomUUID(),key=`uploads/${id}.${format}`,video=data.contentType.startsWith('video/'),thumbnailKey=`uploads/${id}-thumb.jpg`;
  const sign=(key:string,type:string,size?:number)=>getSignedUrl(client,new PutObjectCommand({Bucket:process.env.R2_BUCKET_NAME!,Key:key,ContentType:type,
    ...(size?{ContentLength:size}:{})}),{expiresIn:600});
  return NextResponse.json({success:true,key,uploadUrl:await sign(key,data.contentType,data.size),publicUrl:`/api/media/${key}`,
   contentType:data.contentType,format,mediaType:video?'VIDEO':'IMAGE',thumbnailKey:video?thumbnailKey:null,
   thumbnailUploadUrl:video?await sign(thumbnailKey,'image/jpeg'):null,thumbnailPublicUrl:video?`/api/media/${thumbnailKey}`:null},
   {headers:{'Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({error:'upload_url_failed'},{status:500});}
}
