import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

// Initialize S3 Client
const s3Client = new S3Client({
  region: process.env.R2_REGION || 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_DOMAIN = process.env.R2_PUBLIC_DOMAIN;

// 判断媒体类型
function getMediaType(contentType: string): 'IMAGE' | 'VIDEO' {
  if (contentType.startsWith('video/')) {
    return 'VIDEO';
  }
  return 'IMAGE';
}

// 规范化内容类型（将 HEIC 等转换为 JPEG）
function normalizeContentType(contentType: string, filename: string): { contentType: string; extension: string } {
  const lowerType = contentType.toLowerCase();
  
  // HEIC/HEIF 图片需要客户端转换为 JPEG
  if (lowerType === 'image/heic' || lowerType === 'image/heif') {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  
  // 视频类型保持原样
  if (lowerType.startsWith('video/')) {
    const ext = filename.split('.').pop()?.toLowerCase() || 'mp4';
    return { contentType: lowerType, extension: ext };
  }
  
  // 其他图片类型
  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  
  return { 
    contentType: lowerType, 
    extension: extMap[lowerType] || filename.split('.').pop() || 'jpg'
  };
}

export async function POST(request: NextRequest) {
  if (!R2_BUCKET_NAME) {
    console.error('R2_BUCKET_NAME is not set');
    return NextResponse.json({ error: 'Server configuration error: Bucket name missing' }, { status: 500 });
  }
  if (!R2_PUBLIC_DOMAIN) {
    console.error('R2_PUBLIC_DOMAIN is not set');
    return NextResponse.json({ error: 'Server configuration error: Public URL missing' }, { status: 500 });
  }

  try {
    const { filename, contentType, isVideo = false } = await request.json();

    if (!filename || !contentType) {
      return NextResponse.json({ error: 'Filename and contentType are required' }, { status: 400 });
    }

    // 规范化内容类型和扩展名
    const normalized = normalizeContentType(contentType, filename);
    const mediaType = getMediaType(contentType);
    
    // 生成唯一文件名
    const uniqueId = uuidv4();
    const uniqueKey = `${uniqueId}.${normalized.extension}`;
    
    // 如果是视频，还需要生成缩略图的上传 URL
    let thumbnailUploadUrl: string | null = null;
    let thumbnailKey: string | null = null;
    let thumbnailPublicUrl: string | null = null;
    
    if (isVideo || mediaType === 'VIDEO') {
      thumbnailKey = `thumbnails/${uniqueId}_thumb.jpg`;
      const thumbnailCommand = new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: thumbnailKey,
        ContentType: 'image/jpeg',
      });
      thumbnailUploadUrl = await getSignedUrl(s3Client, thumbnailCommand, { expiresIn: 3600 });
      thumbnailPublicUrl = `${R2_PUBLIC_DOMAIN}/${thumbnailKey}`;
    }

    // 生成主文件上传 URL
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: uniqueKey,
      ContentType: normalized.contentType,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    // 构建公开 URL
    const publicUrl = `${R2_PUBLIC_DOMAIN}/${uniqueKey}`;

    return NextResponse.json({
      success: true,
      uploadUrl: signedUrl,
      key: uniqueKey,
      publicUrl: publicUrl,
      mediaType: mediaType,
      format: normalized.extension,
      contentType: normalized.contentType,
      // 视频专用
      thumbnailUploadUrl,
      thumbnailKey,
      thumbnailPublicUrl,
    });

  } catch (error) {
    console.error('Error generating pre-signed URL:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Failed to generate upload URL', details: errorMessage }, { status: 500 });
  }
}
