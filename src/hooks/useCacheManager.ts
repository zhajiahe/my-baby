import { useCallback, useEffect, useState, useMemo } from 'react'

// 事件发射器用于缓存同步
class CacheEventEmitter {
  private listeners: Map<string, Set<() => void>> = new Map()

  on(event: string, callback: () => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback)
  }

  off(event: string, callback: () => void) {
    this.listeners.get(event)?.delete(callback)
  }

  emit(event: string) {
    this.listeners.get(event)?.forEach(callback => callback())
  }
}

// 全局缓存管理器
class CacheManager {
  private cache = new Map<string, { data: unknown; timestamp: number; loading: boolean }>()
  private eventEmitter = new CacheEventEmitter()
  private defaultDuration = 5 * 60 * 1000 // 5分钟

  get<T>(key: string, duration?: number): T | null {
    const cached = this.cache.get(key)
    if (!cached) return null
    
    const maxAge = duration || this.defaultDuration
    if (Date.now() - cached.timestamp > maxAge) {
      this.cache.delete(key)
      return null
    }
    
    return cached.data as T
  }

  set<T>(key: string, data: T) {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      loading: false
    })
    
    // 通知所有监听者
    this.eventEmitter.emit(key)
    this.eventEmitter.emit('*') // 全局更新事件
  }

  setLoading(key: string, loading: boolean) {
    const cached = this.cache.get(key)
    if (cached) {
      cached.loading = loading
    } else {
      this.cache.set(key, {
        data: null,
        timestamp: Date.now(),
        loading
      })
    }
  }

  isLoading(key: string): boolean {
    return this.cache.get(key)?.loading || false
  }

  invalidate(key: string) {
    this.cache.delete(key)
    this.eventEmitter.emit(key)
  }

  // 支持模式匹配的批量失效
  invalidatePattern(pattern: string | RegExp) {
    const keysToInvalidate: string[] = []
    
    for (const key of this.cache.keys()) {
      if (typeof pattern === 'string') {
        if (key.includes(pattern)) {
          keysToInvalidate.push(key)
        }
      } else {
        if (pattern.test(key)) {
          keysToInvalidate.push(key)
        }
      }
    }
    
    keysToInvalidate.forEach(key => this.invalidate(key))
  }

  // 清除所有缓存
  clear() {
    this.cache.clear()
    this.eventEmitter.emit('*')
  }

  // 订阅缓存变化
  subscribe(key: string, callback: () => void) {
    this.eventEmitter.on(key, callback)
    return () => this.eventEmitter.off(key, callback)
  }

  // 订阅全局缓存变化
  subscribeGlobal(callback: () => void) {
    this.eventEmitter.on('*', callback)
    return () => this.eventEmitter.off('*', callback)
  }

  // 获取缓存大小
  get size() {
    return this.cache.size
  }
}

// 全局缓存管理器实例
export const cacheManager = new CacheManager()

// 通用的缓存hook - 优化版本，支持 stale-while-revalidate
export function useCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: {
    duration?: number
    autoRefresh?: boolean
    dependencies?: readonly unknown[]
    staleWhileRevalidate?: boolean // 新增：先返回旧数据，后台刷新
  } = {}
) {
  const { duration, autoRefresh = true, dependencies = [], staleWhileRevalidate = true } = options
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // 使用 useMemo 创建依赖的稳定引用
  const depsString = useMemo(() => JSON.stringify(dependencies), [dependencies])

  const fetch = useCallback(async (forceRefresh = false) => {
    // 先检查缓存
    const cached = cacheManager.get<T>(key, duration)
    
    if (!forceRefresh && cached !== null) {
      setData(cached)
      return cached
    }

    // stale-while-revalidate: 如果有过期的缓存数据，先返回，后台刷新
    const staleData = cacheManager.get<T>(key, Infinity) // 获取任何存在的数据
    if (staleWhileRevalidate && staleData !== null && !forceRefresh) {
      setData(staleData)
      // 不设置 loading，后台静默刷新
    }

    // 防止重复请求
    if (cacheManager.isLoading(key)) {
      return staleData ?? undefined
    }

    try {
      // 只有没有 stale 数据时才显示 loading
      if (!staleData || forceRefresh) {
        setLoading(true)
      }
      setError(null)
      cacheManager.setLoading(key, true)
      
      const result = await fetcher()
      cacheManager.set(key, result)
      setData(result)
      return result
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')
      // 只有没有 stale 数据时才显示错误
      if (!staleData) {
        setError(error)
      }
      cacheManager.invalidate(key)
      throw error
    } finally {
      setLoading(false)
      cacheManager.setLoading(key, false)
    }
  }, [key, fetcher, duration, staleWhileRevalidate])

  // 订阅缓存变化
  useEffect(() => {
    const unsubscribe = cacheManager.subscribe(key, () => {
      const cached = cacheManager.get<T>(key, duration)
      if (cached !== null) {
        setData(cached)
      }
    })

    return unsubscribe
  }, [key, duration])

  // 初始化数据
  useEffect(() => {
    if (autoRefresh) {
      fetch()
    }
  }, [fetch, autoRefresh, depsString])

  return {
    data,
    loading,
    error,
    refetch: fetch,
    invalidate: () => cacheManager.invalidate(key)
  }
}

// 数据变更操作的hook
export function useCacheInvalidation() {
  return {
    // 失效特定缓存
    invalidate: (key: string) => cacheManager.invalidate(key),
    
    // 失效模式匹配的缓存
    invalidatePattern: (pattern: string | RegExp) => cacheManager.invalidatePattern(pattern),
    
    // 失效baby相关的所有缓存
    invalidateBabyData: (babyId: string) => {
      cacheManager.invalidatePattern(`baby-${babyId}`)
      cacheManager.invalidatePattern(`growth-records-${babyId}`)
      cacheManager.invalidatePattern(`milestones-${babyId}`)
      cacheManager.invalidatePattern(`photos-${babyId}`)
    },
    
    // 清除所有缓存
    clearAll: () => cacheManager.clear()
  }
}

// 提供全局缓存状态的hook
export function useCacheStatus() {
  const [cacheStats, setCacheStats] = useState({
    totalEntries: 0,
    lastUpdated: Date.now()
  })

  useEffect(() => {
    const unsubscribe = cacheManager.subscribeGlobal(() => {
      setCacheStats({
        totalEntries: cacheManager.size,
        lastUpdated: Date.now()
      })
    })

    return unsubscribe
  }, [])

  return cacheStats
} 