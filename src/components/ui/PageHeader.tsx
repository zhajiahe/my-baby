'use client'

import { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  action?: ReactNode
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4 md:mb-6">
      <div>
        <h2 className="text-xl md:text-3xl font-bold text-gray-800 mb-1 md:mb-2">{title}</h2>
        {description && (
          <p className="text-sm md:text-base text-gray-600">{description}</p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

