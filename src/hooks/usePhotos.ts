import { useState, useCallback, useEffect } from 'react'
import { useCache, useCacheInvalidation } from './useCacheManager'

interface MediaItem {
  id: string
  url: string
  date: string
  title: string
  description: string | null
  age: string
  mediaType: 'IMAGE' | 'VIDEO'
  format?: string
  thumbnailUrl?: string
  duration?: number
}

export function usePhotos(babyId?: string) {
  const { invalidate, invalidateBabyData } = useCacheInvalidation()
  const cacheKey = `photos-${babyId}`
  
  const calculateAge = useCallback((date: string, birthDate?: string) => {
    if (!birthDate) return '未知'
    
    const birth = new Date(birthDate)
    const recordDate = new Date(date)
    const diffTime = Math.abs(recordDate.getTime() - birth.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    
    if (diffDays < 30) {
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
  }, [])

  // 分页状态
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(1)
  const [allItems, setAllItems] = useState<MediaItem[]>([])

  // 使用新的缓存系统
  const {
    data: mediaResponse,
    loading,
    error,
    refetch
  } = useCache<{ items: MediaItem[]; pagination: { page: number; limit: number; total: number; hasMore: boolean } }>(
    cacheKey,
    async () => {
      if (!babyId) return { items: [], pagination: { page: 1, limit: 50, total: 0, hasMore: false } }
      const response = await fetch(`/api/photos?babyId=${babyId}&page=1&limit=50`)
      if (!response.ok) {
        throw new Error('Failed to fetch photos')
      }
      const data = await response.json()
      // 兼容旧 API 格式
      if (Array.isArray(data)) {
        return { items: data, pagination: { page: 1, limit: data.length, total: data.length, hasMore: false } }
      }
      return data
    },
    {
      duration: 5 * 60 * 1000, // 5分钟缓存
      autoRefresh: false, // photos通常不自动刷新，因为可能数据量大
      dependencies: [babyId]
    }
  )

  // 同步数据到 allItems
  useEffect(() => {
    if (mediaResponse?.items) {
      setAllItems(mediaResponse.items)
      setHasMore(mediaResponse.pagination?.hasMore ?? false)
      setPage(1)
    }
  }, [mediaResponse])

  // 加载更多
  const loadMore = useCallback(async () => {
    if (!babyId || !hasMore || loading) return
    
    const nextPage = page + 1
    try {
      const response = await fetch(`/api/photos?babyId=${babyId}&page=${nextPage}&limit=50`)
      if (!response.ok) throw new Error('Failed to load more')
      
      const data = await response.json()
      const newItems = Array.isArray(data) ? data : data.items
      const pagination = data.pagination
      
      setAllItems(prev => [...prev, ...newItems])
      setPage(nextPage)
      setHasMore(pagination?.hasMore ?? false)
    } catch (err) {
      console.error('Failed to load more photos:', err)
    }
  }, [babyId, hasMore, loading, page])

  const mediaItems = allItems

  const [operationError, setOperationError] = useState<string | null>(null)

  // 手动触发获取photos的方法
  const fetchPhotos = useCallback(async (forceRefresh = false, birthDate?: string) => {
    try {
      const response = await refetch(forceRefresh)
      
      // 从新 API 响应中提取 items
      const items = response?.items || []
      
      // 如果有birthDate，计算年龄
      if (items.length > 0 && birthDate) {
        const itemsWithAge = items.map((item: MediaItem) => ({
          ...item,
          age: calculateAge(item.date, birthDate)
        }))
        return itemsWithAge
      }
      
      return items
    } catch (err) {
      throw err
    }
  }, [refetch, calculateAge])

  const uploadPhoto = async (uploadData: FormData) => {
    try {
      setOperationError(null)
      // 第一步：上传文件到R2
      const uploadResponse = await fetch('/api/photos/upload', {
        method: 'POST',
        body: uploadData,
      })

      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json()
        throw new Error(errorData.error || '上传文件失败')
      }

      const uploadResult = await uploadResponse.json()
      
      // 第二步：保存元数据到数据库
      const saveResponse = await fetch('/api/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(uploadResult),
      })

      if (!saveResponse.ok) {
        const errorData = await saveResponse.json()
        throw new Error(errorData.error || '保存失败')
      }

      const savedPhoto = await saveResponse.json()
      
      // 失效相关缓存
      if (babyId) {
        invalidate(`photos-${babyId}`)
        invalidateBabyData(babyId) // 同时失效baby统计数据
      }
      
      return savedPhoto
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred'
      setOperationError(errorMessage)
      throw err
    }
  }

  const deletePhoto = async (photoId: string) => {
    try {
      setOperationError(null)
      const response = await fetch(`/api/photos/${photoId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || '删除失败')
      }

      // 失效相关缓存
      if (babyId) {
        invalidate(`photos-${babyId}`)
        invalidateBabyData(babyId)
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred'
      setOperationError(errorMessage)
      throw err
    }
  }

  return {
    mediaItems: mediaItems || [],
    loading,
    error: error?.message || operationError,
    fetchPhotos,
    uploadPhoto,
    deletePhoto,
    loadMore,
    hasMore,
    setMediaItems: () => {
      // 兼容现有代码，但建议使用cache invalidation
      console.warn('setMediaItems is deprecated, use cache invalidation instead')
    },
    refetch: (forceRefresh = false) => {
      setPage(1)
      setAllItems([])
      return refetch(forceRefresh)
    }
  }
} 