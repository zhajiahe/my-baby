'use client'

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  color?: 'teal' | 'amber' | 'gray'
  text?: string
}

const sizeClasses = {
  sm: 'h-8 w-8',
  md: 'h-12 w-12',
  lg: 'h-32 w-32',
}

const colorClasses = {
  teal: 'border-teal-500',
  amber: 'border-amber-500',
  gray: 'border-gray-500',
}

export function LoadingSpinner({ 
  size = 'lg', 
  color = 'teal', 
  text = '加载中...' 
}: LoadingSpinnerProps) {
  return (
    <div className="flex flex-col items-center justify-center py-8 md:py-12">
      <div 
        className={`animate-spin rounded-full border-b-2 ${sizeClasses[size]} ${colorClasses[color]}`}
      />
      {text && <p className="mt-4 text-gray-600 text-sm md:text-base">{text}</p>}
    </div>
  )
}

interface LoadingPageProps {
  text?: string
}

export function LoadingPage({ text = '加载中...' }: LoadingPageProps) {
  return (
    <div className="max-w-6xl mx-auto px-4">
      <LoadingSpinner size="lg" text={text} />
    </div>
  )
}

