'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { prepareImage, prepareVideo, normalizeMediaFile, canPlayVideoType, type ImagePrep, type VideoPrep } from '@/lib/media-client'
import PrivateVideo from './PrivateVideo'
import { videoMetadata, mediaFetch } from '@/lib/media-metadata'
import { createUploadTrace, stageLabels, type UploadStage } from '@/lib/upload-timing'
import { uploadInParts } from '@/lib/multipart-upload'
import { PART_BYTES } from '@/lib/media-multipart'
import { Calendar, Clock, Upload, X, Trash2, Image as ImageIcon, Film } from 'lucide-react'
import { useBaby } from '@/hooks/useBaby'
import { useToastContext } from '@/components/providers/ToastProvider'
import { EmptyPhotos } from '@/components/ui/illustrations'
// heic2any 需要动态导入，因为它使用了 window 对象
// import heic2any from 'heic2any'

interface MediaItem { // Renamed from Photo
  id: string;
  url: string; // URL of the main media (image or video)
  date: string;
  title: string;
  description: string | null; // Made description nullable to match schema
  age: string; // This is client-calculated, will keep for now
  mediaType: 'IMAGE' | 'VIDEO'; // Added
  format?: string; // e.g., "jpeg", "mp4" - Added
  thumbnailUrl?: string; // URL of video thumbnail - Added
  duration?: number; // Video duration in seconds - Added
}

// Helper function to format duration from seconds to MM:SS
const formatDuration = (seconds: number | undefined): string | null => {
  if (seconds === undefined || seconds === null) return null;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
};

// Helper function to format date to Chinese readable format
const formatDateDisplay = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

export default function PhotoGallery() { // Consider renaming to MediaGallery later if desired
  const { baby, loading, error } = useBaby()
  const toast = useToastContext()
  const fileInputRef = useRef<HTMLInputElement>(null); // Ref for file input

  const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
  
  // Debug logging
  
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]) // Renamed from photos, updated type

  const [selectedMediaItem, setSelectedMediaItem] = useState<MediaItem | null>(null);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // 统一上传相关状态
  interface UploadFileItem {
    id: string;
    file: File;
    title: string;
    status: 'pending' | 'uploading' | 'success' | 'error';
    progress: number;
    stage?: UploadStage;
    errorMessage?: string;
    uploadedUrl?: string;
    uploadedResult?: {url:string;mediaType:'IMAGE'|'VIDEO';format:string;thumbnailUrl:string|null;duration:number|null};
  }
  const [uploadFiles, setUploadFiles] = useState<UploadFileItem[]>([]);
  const [uploadDate, setUploadDate] = useState(new Date().toISOString().split('T')[0]);
  const [isUploading, setIsUploading] = useState(false);
  const uploadControllerRef=useRef<AbortController|null>(null);
  useEffect(()=>()=>uploadControllerRef.current?.abort(),[]);

  // 新增：编辑功能状态
  const [isEditing, setIsEditing] = useState(false);
  const [editFormData, setEditFormData] = useState({
    title: '',
    description: ''
  });
  const [isSaving, setIsSaving] = useState(false);

  // 新增：图片尺寸状态，用于自适应大小
  const [imageDimensions, setImageDimensions] = useState<{
    width: number;
    height: number;
    aspectRatio: number;
  } | null>(null);

  const calculateAge = useCallback((date: string) => {
    if (!baby?.birthDate) return '未知'
    
    const birth = new Date(baby.birthDate)
    const photoDate = new Date(date)
    const diffTime = Math.abs(photoDate.getTime() - birth.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) - 1 // 减去1天，不计算刚出生那天
    
    if (diffDays <= 0) {
      return '出生当天'
    } else if (diffDays < 30) {
      return `${diffDays}天`
    } else if (diffDays < 365) {
      const months = Math.floor(diffDays / 30)
      const days = diffDays % 30
      return `${months}个月${days}天`
    } else {
      const years = Math.floor(diffDays / 365)
      const months = Math.floor((diffDays % 365) / 30)
      return `${years}岁${months}个月`
    }
  }, [baby?.birthDate])

  // Load media items when baby changes or component mounts
  useEffect(() => {
    const loadMediaItems = async () => {
      if (!baby?.id) {
        setMediaItems([])
        return
      }

      try {
        const response = await fetch(`/api/photos?babyId=${baby.id}`)
        
        if (response.ok) {
          const data = await response.json()
          // 兼容新的分页 API 格式和旧的数组格式
          const items = Array.isArray(data) ? data : (data.items || [])
          const itemsWithAge = items.map((item: MediaItem) => ({
            ...item,
            age: calculateAge(item.date)
          }))
          setMediaItems(itemsWithAge)
        } else {
          console.error('Failed to fetch media items')
        }
      } catch (error) {
        console.error('Error loading media items:', error)
      }
    }
    
    loadMediaItems()
  }, [baby?.id, calculateAge])

  // Update ages when baby birth date changes
  useEffect(() => {
    if (baby?.birthDate) {
      // Only update if we have items and the birthDate has actually changed
      setMediaItems(prevItems => {
        if (prevItems.length === 0) return prevItems
        
        return prevItems.map(item => ({
          ...item,
          age: calculateAge(item.date)
        }))
      })
    }
  }, [baby?.birthDate, calculateAge])

  // 新增：处理图片加载以获取自然尺寸
  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    const aspectRatio = img.naturalWidth / img.naturalHeight;
    setImageDimensions({
      width: img.naturalWidth,
      height: img.naturalHeight,
      aspectRatio
    });
  };

  // 新增：计算自适应容器样式
  const getContainerStyle = () => {
    if (!imageDimensions) {
      return { maxWidth: '100%', maxHeight: '70vh', aspectRatio: '16/9' }; // 默认值
    }
    
    const maxWidth = typeof window !== 'undefined' ? window.innerWidth * 0.8 : 800;
    const maxHeight = typeof window !== 'undefined' ? window.innerHeight * 0.7 : 600;
    const { aspectRatio } = imageDimensions;
    
    let width, height;
    
    if (aspectRatio > 1) {
      // 横图：以宽度为基准
      width = Math.min(maxWidth, 800);
      height = width / aspectRatio;
      if (height > maxHeight) {
        height = maxHeight;
        width = height * aspectRatio;
      }
    } else {
      // 竖图：以高度为基准
      height = Math.min(maxHeight, 600);
      width = height * aspectRatio;
      if (width > maxWidth) {
        width = maxWidth;
        height = width / aspectRatio;
      }
    }
    
    return {
      width: `${width}px`,
      height: `${height}px`,
      maxWidth: '90vw',
      maxHeight: '80vh'
    };
  };

  // 新增：开始编辑
  const handleStartEdit = () => {
    if (!selectedMediaItem) return;
    setEditFormData({
      title: selectedMediaItem.title,
      description: selectedMediaItem.description || ''
    });
    setIsEditing(true);
  };

  // 新增：取消编辑
  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditFormData({ title: '', description: '' });
  };

  // 新增：保存编辑
  const handleSaveEdit = async () => {
    if (!selectedMediaItem) return;
    
    // title is now optional - no validation required

    setIsSaving(true);
    try {
      const response = await fetch(`/api/photos/${selectedMediaItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editFormData.title.trim(), // empty string is allowed
          description: editFormData.description.trim() || null
        })
      });
      
      if (response.ok) {
        const updatedItem = await response.json();
        
        // 更新本地状态
        setMediaItems(prev => prev.map(item => 
          item.id === selectedMediaItem.id 
            ? { ...item, title: updatedItem.title, description: updatedItem.description }
            : item
        ));
        
        setSelectedMediaItem(prev => prev ? { 
          ...prev, 
          title: updatedItem.title, 
          description: updatedItem.description 
        } : null);
        
        setIsEditing(false);
        toast.success('保存成功', '媒体信息已更新');
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || '保存失败');
      }
    } catch (error) {
      console.error('Edit failed:', error);
      const errorMessage = error instanceof Error ? error.message : '保存过程中发生未知错误';
      toast.error('保存失败', errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  // 处理文件选择
  const handleFileSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    const newItems: UploadFileItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = normalizeMediaFile(files[i]);
      if (file.size > MAX_FILE_SIZE) {
        toast.error('文件过大', `文件 "${file.name}" 超过 ${MAX_FILE_SIZE / (1024 * 1024)}MB 限制`);
        continue;
      }
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        toast.error('不支持的文件类型', `文件 "${file.name}" 不是图片或视频`);
        continue;
      }
      newItems.push({
        id: crypto.randomUUID(),
        file,
        title: '', // 标题为空，可选填写
        status: 'pending',
        progress: 0,
      });
    }
    
    setUploadFiles(prev => [...prev, ...newItems]);
  };

  // 更新文件标题
  const updateFileTitle = (id: string, title: string) => {
    setUploadFiles(prev => prev.map(item => 
      item.id === id ? { ...item, title } : item
    ));
  };

  // 移除文件
  const removeFile = (id: string) => {
    setUploadFiles(prev => prev.filter(item => item.id !== id));
  };

  // 清空所有文件
  const clearAllFiles = () => {
    setUploadFiles([]);
  };

  // 辅助函数：清理文件名，确保只包含安全字符
  const sanitizeFileName = (name: string): string => {
    // 保留扩展名
    const ext = name.split('.').pop()?.toLowerCase() || '';
    const baseName = name.substring(0, name.lastIndexOf('.') || name.length);
    // 只保留字母、数字、下划线和连字符
    const safeName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
    return ext ? `${safeName}.${ext}` : safeName;
  };

  // Map the stored container back to the type the capability probe expects.
  const videoMime = (format?: string): string => (({mov:'video/quicktime',mp4:'video/mp4',webm:'video/webm'} as Record<string,string>)[format || ''] || 'video/mp4');

  // 辅助函数：处理视频元数据（缩略图 + 时长，只加载一次视频）
  // A cover is best effort: the original is already stored, so a device that cannot
  // decode the container must not fail the whole upload.
  const processVideoMetadata = async (file: File,signal:AbortSignal): Promise<{
    thumbnail: Blob | null;
    duration: number | null;
  }> => {
    try{return await videoMetadata(file,15000,signal);}
    catch{return {thumbnail:null,duration:null};}
  };

  // 辅助函数：直接上传到 R2（绕过服务器，解决文件大小限制）
  const uploadDirectToR2 = async (
    file: File,
    uploadId: string,
    signal: AbortSignal,
    onProgress: (progress: number) => void,
    onStage: (stage: UploadStage) => void,
    trace: ReturnType<typeof createUploadTrace>
  ): Promise<{
    url: string;
    mediaType: 'IMAGE' | 'VIDEO';
    format: string;
    thumbnailUrl: string | null;
    duration: number | null;
  }> => {
    const isVideo = file.type.startsWith('video/');
    const report=(from:number,to:number,fraction:number)=>onProgress(from+Math.round(Math.max(0,Math.min(1,fraction))*(to-from)));

    // Stage 1: keep the original bytes. Nothing is re-encoded before the file is stored,
    // so a slow or interrupted radio never costs a finished conversion.
    onStage(isVideo?'video_preprocessing':'photo_processing');
    const prepared = await trace.stage<ImagePrep|VideoPrep>(isVideo?'video_preprocessing':'photo_processing',
      ()=>isVideo?prepareVideo(file,{signal}):prepareImage(file,signal));
    const blob = prepared.original;
    const preview = 'preview' in prepared ? prepared.preview : null;
    if(signal.aborted)throw new Error('上传已取消，可重试');
    if(blob.size>100*1024*1024)throw new Error('原片超过 100MB，请选择较短的视频');
    report(0,10,1);

    // Stage 2: presign. The object key is always derived server-side from the upload id.
    onStage('presign');
    const urlData = await trace.stage('presign',async()=>{
      const urlResponse = await mediaFetch('/api/photos/generate-upload-url', {
        signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          filename: sanitizeFileName(file.name),
          contentType: blob.type || file.type,
          size: blob.size,
          isVideo,
        }),
      });
      if (!urlResponse.ok) {
        const errorData = await urlResponse.json().catch(() => ({}));
        throw new Error(errorData.error || '获取上传链接失败');
      }
      return await urlResponse.json();
    });
    report(10,15,1);

    // Stage 3: transfer. Video and anything larger than one part uses multipart, which is
    // the only path that can report byte progress, retry a single part and resume.
    onStage('r2_put');
    await trace.stage('r2_put',async()=>{
      if(isVideo||blob.size>=PART_BYTES){
        await uploadInParts(blob,{uploadId,signal,onProgress:fraction=>report(15,80,fraction)});
        return;
      }
      const uploadResponse = await mediaFetch(urlData.uploadUrl, {
        signal,
        method: 'PUT',
        headers: { 'Content-Type': urlData.contentType },
        body: blob,
      });
      if (!uploadResponse.ok) throw new Error(`上传失败 (HTTP ${uploadResponse.status})`);
      report(15,80,1);
    },{bytes:blob.size});

    // Stage 4: cover. HEIC reuses the Safari-decoded preview; a video captures one frame.
    // A missing cover never fails an upload that has already stored its original.
    onStage('thumbnail');
    let thumbnailUrl: string | null = null;
    let duration: number | null = null;
    const thumbnailBlob = preview ?? (isVideo ? (await trace.stage('thumbnail',async()=>{
      const metadata = await processVideoMetadata(blob,signal);
      duration = metadata.duration;
      return metadata.thumbnail;
    })) : null);
    if(thumbnailBlob && urlData.thumbnailUploadUrl){
      await trace.stage('thumbnail',async()=>{
        const thumbResponse = await mediaFetch(urlData.thumbnailUploadUrl, {
          signal,
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          body: thumbnailBlob,
        });
        if (thumbResponse.ok) thumbnailUrl = urlData.thumbnailPublicUrl;
      });
    }
    report(80,92,1);

    return {
      url: urlData.publicUrl,
      mediaType: urlData.mediaType,
      format: urlData.format,
      thumbnailUrl,
      duration,
    };
  };

  // 上传处理 - 直接上传到 R2（更快，无文件大小限制）
  const handleUpload = async () => {
    if(uploadControllerRef.current)return;
    if (!baby?.id) {
      toast.error('验证失败', '请先创建宝宝信息。');
      return;
    }
    if (uploadFiles.length === 0) {
      toast.error('验证失败', '请先选择要上传的文件。');
      return;
    }

    const controller=new AbortController();uploadControllerRef.current=controller;
    setIsUploading(true);
    const successfulItems: MediaItem[] = [];

    // 逐个上传文件
    for (let i = 0; i < uploadFiles.length; i++) {
      if(controller.signal.aborted)break;
      const item = uploadFiles[i];
      if (item.status === 'success') continue;
      
      // 更新状态为上传中
      setUploadFiles(prev => prev.map(f => 
        f.id === item.id ? { ...f, status: 'uploading' as const, progress: 0 } : f
      ));

      const trace = createUploadTrace();
      try {
        // 直接上传到 R2（绕过服务器）
        const uploadResult = item.uploadedResult ?? await uploadDirectToR2(item.file, item.id, controller.signal, (progress) => {
          setUploadFiles(prev => prev.map(f =>
            f.id === item.id ? { ...f, progress } : f
          ));
        }, (stage) => {
          setUploadFiles(prev => prev.map(f => f.id === item.id ? { ...f, stage } : f));
        }, trace);

        // 更新进度到 85%
        setUploadFiles(prev => prev.map(f => 
          f.id === item.id ? { ...f, progress: 85, uploadedUrl: uploadResult.url, uploadedResult: uploadResult } : f
        ));

        // 保存元数据到数据库
        const mediaDataForDb = {
          uploadId: item.id,
          babyId: baby.id,
          date: uploadDate,
          title: item.title || '',
          url: uploadResult.url,
          mediaType: uploadResult.mediaType,
          format: uploadResult.format,
          thumbnailUrl: uploadResult.thumbnailUrl || null,
          duration: uploadResult.duration || null,
        };

        const saveResponse = await trace.stage('d1_save',()=>mediaFetch('/api/photos', {
          signal:controller.signal,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mediaDataForDb),
        }));

        // 先读取响应文本
        const saveResponseText = await saveResponse.text();
        
        if (!saveResponse.ok) {
          let errorMessage = '保存媒体信息失败';
          try {
            const errorData = JSON.parse(saveResponseText);
            errorMessage = errorData.error || errorData.message || errorMessage;
          } catch {
            if (saveResponseText) {
              const cleanedMessage = saveResponseText.replace(/<[^>]*>/g, '').trim();
              errorMessage = cleanedMessage.substring(0, 100) || `保存失败 (HTTP ${saveResponse.status})`;
            } else {
              errorMessage = `保存失败 (HTTP ${saveResponse.status})`;
            }
          }
          throw new Error(errorMessage);
        }

        let savedItem;
        try {
          savedItem = JSON.parse(saveResponseText);
        } catch {
          console.error('media_save_invalid_response');
          throw new Error('保存响应格式错误');
        }
        trace.log('ok');
        successfulItems.push({
          ...savedItem,
          age: calculateAge(savedItem.date),
        });

        // 更新状态为成功
        setUploadFiles(prev => prev.map(f => 
          f.id === item.id ? { ...f, status: 'success' as const, progress: 100 } : f
        ));

      } catch (error) {
        console.error('media_upload_failed');
        
        // 更详细的错误信息处理
        let errorMessage = '上传失败';
        if (error instanceof Error) {
          // 特殊处理一些常见的浏览器错误
          if (error.message.includes('pattern') || error.message.includes('Pattern')) {
            errorMessage = '文件格式验证失败，请尝试重新选择文件';
          } else if (error.message.includes('network') || error.message.includes('Network')) {
            errorMessage = '网络连接失败，请检查网络后重试';
          } else if (error.message.includes('timeout') || error.message.includes('Timeout')) {
            errorMessage = '上传超时，请稍后重试';
          } else {
            errorMessage = error.message;
          }
        } else if (typeof error === 'string') {
          errorMessage = error;
        }
        
        setUploadFiles(prev => prev.map(f => 
          f.id === item.id ? { ...f, status: 'error' as const, errorMessage } : f
        ));
      }
    }

    // 添加成功上传的媒体到列表
    if (successfulItems.length > 0) {
      setMediaItems(prev => [...successfulItems, ...prev]);
      toast.success('上传完成', `成功上传 ${successfulItems.length} 个文件`);
    }

    uploadControllerRef.current=null;
    setIsUploading(false);
    
    // 如果全部成功，清空并关闭
    if (successfulItems.length + uploadFiles.filter(f => f.status === 'success').length === uploadFiles.length) {
      setUploadFiles([]);
      setShowUploadForm(false);
    }
  };

  // Renamed from groupedPhotos to groupedMediaItems
  const groupedMediaItems = mediaItems.reduce((acc, item) => { // Renamed variable
    const month = item.date.substring(0, 7);
    if (!acc[month]) acc[month] = [];
    acc[month].push(item);
    return acc;
  }, {} as Record<string, MediaItem[]>); // Updated type

  // Add delete handler for media items
  const handleDeleteMediaItem = async (mediaItemId: string) => {
    if (!confirm('确定要删除这个媒体文件吗？此操作无法撤销。')) {
      return;
    }

    try {
      const response = await fetch(`/api/photos/${mediaItemId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // Remove the item from local state
        setMediaItems(prev => prev.filter(item => item.id !== mediaItemId));
        // Close the modal if this item was selected and reset all states
        if (selectedMediaItem?.id === mediaItemId) {
          setSelectedMediaItem(null);
          setIsEditing(false);
          setImageDimensions(null);
        }
        toast.success('删除成功', '媒体文件已成功删除')
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || '删除失败');
      }
    } catch (error) {
      console.error('Delete failed:', error);
      const errorMessage = error instanceof Error ? error.message : '删除过程中发生未知错误';
      toast.error('删除失败', errorMessage)
    }
  };

  // Show loading state if baby is still loading
  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-teal-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  // Show error state if there's an error loading baby data
  if (error) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="text-center py-12">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <X className="w-6 h-6 text-red-500" />
          </div>
          <p className="text-red-600">加载失败: {error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4 md:space-y-6">
      {/* 页面标题 */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h2 className="text-xl md:text-3xl font-bold text-gray-800 mb-1">媒体墙</h2>
          <p className="text-sm md:text-base text-gray-600">记录宝宝成长的珍贵时刻</p>
        </div>
        <button
          onClick={() => setShowUploadForm(true)}
          className="btn-primary text-sm md:text-base py-2 md:py-3"
        >
          上传媒体文件
        </button>
      </div>

      {/* Upload Form - 统一的多文件上传界面 */}
      {showUploadForm && (
        <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-t-2xl md:rounded-xl w-full md:max-w-2xl p-4 md:p-6 max-h-[85vh] md:max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg md:text-xl font-bold text-gray-800">上传媒体文件</h3>
              <button
                onClick={() => {
                  if (isUploading) return;
                  setShowUploadForm(false);
                  setUploadFiles([]);
                  setUploadError(null);
                }}
                className="text-gray-400 hover:text-gray-600 text-2xl p-1"
                disabled={isUploading}
              >
                ×
              </button>
            </div>

            {uploadError && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
                <strong className="font-bold">发生错误: </strong>
                <span className="block sm:inline">{uploadError}</span>
              </div>
            )}

            <div className="space-y-4">
              {/* 文件选择区域 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  选择文件 (支持多选，图片/视频)
                </label>
                <div 
                  className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-teal-400 transition-colors cursor-pointer"
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('border-teal-400', 'bg-teal-50'); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('border-teal-400', 'bg-teal-50'); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.classList.remove('border-teal-400', 'bg-teal-50');
                    handleFileSelect(e.dataTransfer.files);
                  }}
                  onClick={() => document.getElementById('media-upload')?.click()}
                >
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    id="media-upload"
                    ref={fileInputRef}
                    onChange={(e) => handleFileSelect(e.target.files)}
                    disabled={isUploading}
                  />
                  <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-primary/10 flex items-center justify-center">
                    <Upload className="w-6 h-6 text-primary" />
                  </div>
                  <p className="text-text-primary mb-1 font-medium">拖拽文件到这里，或点击选择</p>
                  <p className="text-xs text-text-muted">支持图片和视频，单个文件最大 200MB</p>
                </div>
              </div>

              {/* 日期设置 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  拍摄日期 <span className="text-gray-400 font-normal">(应用于所有文件)</span>
                </label>
                <input
                  type="date"
                  value={uploadDate}
                  onChange={(e) => setUploadDate(e.target.value)}
                  className="input-field"
                  disabled={isUploading}
                />
              </div>

              {/* 文件列表 */}
              {uploadFiles.length > 0 && (
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      已选择 {uploadFiles.length} 个文件
                    </label>
                    {!isUploading && (
                      <button
                        onClick={clearAllFiles}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        清空全部
                      </button>
                    )}
                  </div>
                  <div className="space-y-2 max-h-72 overflow-y-auto border rounded-lg p-2 bg-gray-50">
                    {uploadFiles.map((item) => (
                      <div 
                        key={item.id} 
                        className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                          item.status === 'success' ? 'bg-green-50 border border-green-200' :
                          item.status === 'error' ? 'bg-red-50 border border-red-200' :
                          item.status === 'uploading' ? 'bg-blue-50 border border-blue-200' :
                          'bg-white border border-gray-200'
                        }`}
                      >
                        {/* 文件类型图标 */}
                        <div className="flex-shrink-0">
                          {item.file.type.startsWith('image/') ? (
                            <ImageIcon className="w-6 h-6 text-blue-500" />
                          ) : (
                            <Film className="w-6 h-6 text-purple-500" />
                          )}
                        </div>
                        
                        {/* 文件信息 */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{item.file.name}</p>
                          <p className="text-xs text-gray-500">
                            {(item.file.size / (1024 * 1024)).toFixed(2)} MB
                            {item.file.type.startsWith('video/') && ' · 视频将自动生成封面'}
                          </p>
                          
                          {/* 标题输入框 (可选) */}
                          {item.status === 'pending' && (
                            <input
                              type="text"
                              value={item.title}
                              onChange={(e) => updateFileTitle(item.id, e.target.value)}
                              placeholder="标题 (可选)"
                              className="mt-2 w-full text-sm px-3 py-1.5 border border-gray-300 rounded-md focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                              disabled={isUploading}
                            />
                          )}
                          
                          {/* 上传进度条 */}
                          {item.status === 'uploading' && (
                            <div className="mt-2">
                              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-gradient-to-r from-teal-400 to-teal-600 transition-all duration-300"
                                  style={{ width: `${item.progress}%` }}
                                />
                              </div>
                              <p className="text-xs text-teal-600 mt-1">
                                {item.stage ? stageLabels[item.stage] : '上传中'} {item.progress}%
                              </p>
                            </div>
                          )}
                          
                          {/* 成功状态 */}
                          {item.status === 'success' && (
                            <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                              <span>✓</span> 上传成功
                            </p>
                          )}
                          
                          {/* 错误状态 */}
                          {item.status === 'error' && (
                            <p className="text-xs text-red-600 mt-1">✗ {item.errorMessage}</p>
                          )}
                        </div>
                        
                        {/* 删除按钮 */}
                        {item.status === 'pending' && !isUploading && (
                          <button
                            onClick={() => removeFile(item.id)}
                            className="text-gray-400 hover:text-red-500 flex-shrink-0 p-1"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 上传按钮 */}
              <div className="flex space-x-3 mt-6">
                {isUploading&&<button onClick={()=>uploadControllerRef.current?.abort()} className="btn-secondary">取消上传</button>}
                <button
                  onClick={handleUpload}
                  className="btn-primary flex-1"
                  disabled={isUploading || uploadFiles.length === 0}
                >
                  {isUploading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                      </svg>
                      上传中...
                    </span>
                  ) : (
                    `上传 ${uploadFiles.length || ''} 个文件`
                  )}
                </button>
                <button
                  onClick={() => {
                    if (isUploading) return;
                    setShowUploadForm(false);
                    setUploadFiles([]);
                    setUploadError(null);
                  }}
                  className={`btn-secondary flex-1 ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                  disabled={isUploading}
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Media Item Detail Modal */}
      {selectedMediaItem && ( // Renamed from selectedPhoto
        <div 
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0, 0, 0, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', zIndex: 50 }}
          onClick={() => {
            setSelectedMediaItem(null);
            setIsEditing(false);
            setImageDimensions(null);
          }}
        >
          <div 
            className="bg-white dark:bg-slate-800 rounded-xl max-w-4xl w-full max-h-[95vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                {!isEditing ? (
                  <h3 className="text-xl font-bold text-gray-800">
                    {selectedMediaItem.title || <span className="text-gray-400 italic"> </span>}
                  </h3>
                ) : (
                  <div className="flex-1 mr-4">
                    <input
                      type="text"
                      value={editFormData.title}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, title: e.target.value }))}
                      className="text-xl font-bold text-gray-800 w-full border-b-2 border-blue-300 focus:border-blue-500 outline-none bg-transparent"
                      placeholder="输入标题..."
                    />
                  </div>
                )}
                <div className="flex items-center space-x-2">
                  {!isEditing ? (
                    <>
                      <button
                        onClick={handleStartEdit}
                        className="text-blue-500 hover:text-blue-700 text-sm px-3 py-1 border border-blue-300 rounded hover:bg-blue-50 transition-colors"
                        title="编辑媒体信息"
                      >
                        ✏️ 编辑
                      </button>
                      <button
                        onClick={() => handleDeleteMediaItem(selectedMediaItem.id)}
                        className="text-red-500 hover:text-red-700 text-sm px-3 py-1 border border-red-300 rounded hover:bg-red-50 transition-colors"
                        title="删除媒体文件"
                      >
                        <Trash2 className="w-4 h-4 mr-1" /> 删除
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={handleSaveEdit}
                        disabled={isSaving}
                        className="text-green-500 hover:text-green-700 text-sm px-3 py-1 border border-green-300 rounded hover:bg-green-50 transition-colors disabled:opacity-50"
                        title="保存修改"
                      >
                        {isSaving ? '保存中...' : '💾 保存'}
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        disabled={isSaving}
                        className="text-gray-500 hover:text-gray-700 text-sm px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 transition-colors disabled:opacity-50"
                        title="取消编辑"
                      >
                        <X className="w-4 h-4 mr-1" /> 取消
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => {
                      setSelectedMediaItem(null);
                      setIsEditing(false);
                      setImageDimensions(null);
                    }}
                                className="flex items-center justify-center w-10 h-10 bg-gray-100 dark:bg-slate-700 hover:bg-red-500 text-gray-600 dark:text-gray-300 hover:text-white rounded-full transition-all duration-200 shadow-md hover:shadow-lg group"
                    title="关闭"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              
              {/* 自适应媒体容器 */}
              <div 
                className="bg-gray-100 rounded-lg mb-4 flex items-center justify-center overflow-hidden"
                style={getContainerStyle()}
              >
                {selectedMediaItem.mediaType === 'IMAGE' ? (
                  /* Private /api/media paths must be loaded by the browser with the family
                     cookie. next/image routes them through the optimizer, which rejects
                     them with 400, so every card fell back to its placeholder. */
                  <img
                    src={selectedMediaItem.url}
                    alt={selectedMediaItem.title}
                    className="w-full h-full object-contain"
                    onLoad={handleImageLoad}
                    onError={(e) => {
                      console.error('Modal image failed to load:', selectedMediaItem.url);
                      console.error('Modal image error event:', e);
                      // Show a placeholder or error state
                      e.currentTarget.style.display = 'none';
                      e.currentTarget.nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                ) : selectedMediaItem.mediaType === 'VIDEO' ? (
                  canPlayVideoType(videoMime(selectedMediaItem.format)) ? (
                  <PrivateVideo key={selectedMediaItem.id} src={selectedMediaItem.url} poster={selectedMediaItem.thumbnailUrl}
                    onDimensions={(width,height)=>setImageDimensions({width,height,aspectRatio:width/height})}
                  />
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
                      <p className="text-sm text-gray-600">此浏览器不支持播放该视频格式（HEVC）。请在 iPhone/Safari 打开，或下载原片。</p>
                      <a href={selectedMediaItem.url} download className="text-sm text-blue-600 underline">下载原片</a>
                    </div>
                  )
                ) : (
                  <div className="text-center">
                    <div className="text-6xl mb-2">❓</div>
                    <p className="text-gray-600">未知媒体类型</p>
                    <p className="text-sm text-gray-500">{selectedMediaItem.url}</p>
                  </div>
                )}
                {/* Error fallback for modal images */}
                <div className="hidden w-full h-full flex items-center justify-center bg-red-50">
                  <div className="text-center">
                    <div className="text-4xl mb-2">⚠️</div>
                    <p className="text-red-600 mb-2">图片加载失败</p>
                    <p className="text-sm text-gray-500 break-all px-4">{selectedMediaItem.url}</p>
                    <button
                      onClick={() => window.open(selectedMediaItem.url, '_blank')}
                      className="mt-2 text-sm text-blue-600 hover:text-blue-800 underline"
                    >
                      尝试在新窗口打开
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center flex-wrap gap-4 text-sm text-text-secondary">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" /> {selectedMediaItem.date}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" /> {selectedMediaItem.age}
                  </span>
                  {selectedMediaItem.mediaType === 'VIDEO' && selectedMediaItem.duration && (
                    <span className="flex items-center gap-1">
                      <Film className="w-4 h-4" /> {formatDuration(selectedMediaItem.duration)}
                    </span>
                  )}
                  {imageDimensions && (
                    <span>📐 {imageDimensions.width} × {imageDimensions.height}</span>
                  )}
                </div>
                
                {/* 描述部分 - 支持编辑 */}
                {!isEditing ? (
                  <div>
                    <p className="text-gray-700 text-sm font-medium mb-1">描述：</p>
                    <p className="text-gray-700">
                      {selectedMediaItem.description || '暂无描述'}
                    </p>
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">描述：</label>
                    <textarea
                      value={editFormData.description}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, description: e.target.value }))}
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                      rows={3}
                      placeholder="描述这个媒体文件的故事..."
                    />
                  </div>
                )}
                
                <div className="text-xs text-gray-500">
                  {selectedMediaItem.format && <span>格式: {selectedMediaItem.format}</span>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Media Gallery */}
      <div className="space-y-8">
        {Object.entries(groupedMediaItems) // Renamed from groupedPhotos
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([month, monthItems]) => ( // Renamed from monthPhotos
          <div key={month} className="space-y-4">
            <h3 className="text-lg font-bold text-text-primary flex items-center">
              <Calendar className="w-5 h-5 mr-2 text-primary" />
              {month}
              <span className="ml-2 text-sm text-text-muted font-normal">({monthItems.length} 个媒体)</span>
            </h3>
            
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-4">
              {monthItems // Renamed from monthPhotos
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((item) => ( // Renamed from photo to item
                <div
                  key={item.id}
                  data-testid={`media-card-${item.id}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`查看${item.mediaType === 'VIDEO' ? '视频' : '图片'} ${item.title || ''}`}
                  onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setSelectedMediaItem(item)}}}
                  onClick={() => setSelectedMediaItem(item)} // Renamed state setter
                  className="cursor-pointer group"
                >
                  <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden shadow-md group-hover:shadow-lg transition-shadow relative">
                    {item.mediaType === 'IMAGE' ? (
                      <img
                        src={item.url}
                        alt={item.title}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          console.error('image_load_failed');
                          // Show a placeholder or error state
                          e.currentTarget.style.display = 'none';
                          e.currentTarget.nextElementSibling?.classList.remove('hidden');
                        }}
                        onLoad={() => {
                        }}
                      />
                    ) : item.mediaType === 'VIDEO' ? (
                      <>
                        <img
                          src={item.thumbnailUrl || '/placeholder-video-thumb.svg'}
                          alt={item.title + " thumbnail"}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            // Fall back to the visible placeholder. Hiding the element
                            // left a blank cover with only a console error, which is the
                            // hardest failure to notice.
                            console.error('video_thumbnail_load_failed');
                            e.currentTarget.src = '/placeholder-video-thumb.svg';
                          }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-20 group-hover:bg-opacity-10 transition-opacity">
                          <svg className="w-12 h-12 text-white opacity-80" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                          </svg>
                        </div>
                        {item.duration && (
                           <span className="absolute bottom-1 right-1 bg-black bg-opacity-70 text-white text-xs px-1.5 py-0.5 rounded">
                            {formatDuration(item.duration)}
                          </span>
                        )}
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="text-center">
                          <div className="text-4xl mb-2">❓</div>
                          <p className="text-xs text-gray-600 px-2">{item.title}</p>
                        </div>
                      </div>
                    )}
                    {/* Error fallback for images */}
                    <div className="hidden w-full h-full flex items-center justify-center bg-red-50">
                      <div className="text-center">
                        <div className="text-2xl mb-2">⚠️</div>
                        <p className="text-xs text-red-600 px-2">图片加载失败</p>
                        <p className="text-xs text-gray-500 px-2 mt-1">{item.title}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-2">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {item.title || <span className="text-gray-400 italic"> </span>}
                    </p>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>{item.date}</span>
                      <span>{item.age}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {mediaItems.length === 0 && (
        <div className="text-center py-8 md:py-12 animate-fade-in-up">
          <EmptyPhotos className="w-40 h-32 md:w-48 md:h-40 mx-auto mb-4" />
          <h3 className="text-lg md:text-xl font-bold text-gray-800 mb-2">还没有上传任何媒体</h3>
          <p className="text-sm md:text-base text-gray-600 mb-6">开始记录宝宝的珍贵时刻吧！</p>
          <button
            onClick={() => setShowUploadForm(true)}
            className="btn-primary"
          >
            <Upload className="w-4 h-4" />
            上传第一个文件
          </button>
        </div>
      )}
    </div>
  )
} 