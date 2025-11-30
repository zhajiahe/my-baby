'use client'

import { ReactNode } from 'react'

interface EmptyStateProps {
  icon: string
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="text-center py-8 md:py-12 px-4">
      <div className="text-4xl md:text-6xl mb-3 md:mb-4">{icon}</div>
      <h3 className="text-lg md:text-xl font-bold text-gray-800 mb-2">{title}</h3>
      {description && (
        <p className="text-sm md:text-base text-gray-600 mb-4">{description}</p>
      )}
      {action}
    </div>
  )
}

interface ErrorStateProps {
  message: string
  onRetry?: () => void
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="text-center py-8 md:py-12 px-4">
      <div className="text-4xl md:text-6xl mb-3 md:mb-4">❌</div>
      <p className="text-red-600 text-sm md:text-base mb-4">加载失败: {message}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary text-sm">
          重试
        </button>
      )}
    </div>
  )
}

