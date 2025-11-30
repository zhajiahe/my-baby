'use client'

interface StatCardProps {
  icon: string
  label: string
  value: string | number
  color?: 'blue' | 'green' | 'teal' | 'amber' | 'rose'
  onClick?: () => void
}

const colorClasses = {
  blue: 'text-blue-600',
  green: 'text-green-600',
  teal: 'text-teal-600',
  amber: 'text-amber-600',
  rose: 'text-rose-600',
}

export function StatCard({ icon, label, value, color = 'teal', onClick }: StatCardProps) {
  const Wrapper = onClick ? 'button' : 'div'
  
  return (
    <Wrapper 
      className={`card text-center w-full ${onClick ? 'cursor-pointer hover:shadow-lg transition-shadow' : ''}`}
      onClick={onClick}
    >
      <div className="text-2xl md:text-3xl mb-1 md:mb-2">{icon}</div>
      <p className="text-xs md:text-sm text-gray-600 mb-1">{label}</p>
      <p className={`text-lg md:text-2xl font-bold ${colorClasses[color]}`}>{value}</p>
    </Wrapper>
  )
}

