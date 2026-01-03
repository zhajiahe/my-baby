'use client'

import { useState, useEffect } from 'react'
import { useBaby } from '@/hooks/useBaby'
import { useGrowthRecords } from '@/hooks/useGrowthRecords'
import { useMilestones } from '@/hooks/useMilestones'
import Image from 'next/image'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { Baby, Sparkles, Camera, BarChart3, Scale, Ruler, Trophy } from 'lucide-react'
import { EmptyMilestones } from '@/components/ui/illustrations'

interface DashboardProps {
  setActiveTab: (tab: string) => void
}

export default function Dashboard({ setActiveTab }: DashboardProps) {
  const { baby, loading: babyLoading } = useBaby()
  const { records } = useGrowthRecords(baby?.id)
  const { milestones, loading: milestonesLoading } = useMilestones(baby?.id)

  const [currentAge, setCurrentAge] = useState('')
  const [currentDays, setCurrentDays] = useState(0)
  const [descLines, setDescLines] = useState(3)

  // Calculate age when baby data is available
  useEffect(() => {
    if (baby?.birthDate) {
      const birth = new Date(baby.birthDate)
      const now = new Date()
      const diffTime = Math.abs(now.getTime() - birth.getTime())
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) - 1 // 减去1天，不计算刚出生那天
      
      // Set total days
      setCurrentDays(diffDays)
      
      if (diffDays <= 0) {
        setCurrentAge('出生当天')
      } else if (diffDays < 30) {
        setCurrentAge(`${diffDays}天`)
      } else if (diffDays < 365) {
        const months = Math.floor(diffDays / 30)
        const days = diffDays % 30
        setCurrentAge(`${months}个月${days}天`)
      } else {
        const years = Math.floor(diffDays / 365)
        const months = Math.floor((diffDays % 365) / 30)
        setCurrentAge(`${years}岁${months}个月`)
      }
    }
  }, [baby?.birthDate])

  // Responsive clamp lines for recent record description
  useEffect(() => {
    const updateLines = () => {
      if (typeof window === 'undefined') return
      const width = window.innerWidth
      if (width < 768) {
        setDescLines(1)
      } else if (width < 1024) {
        setDescLines(2)
      } else {
        setDescLines(3)
      }
    }
    updateLines()
    window.addEventListener('resize', updateLines)
    return () => window.removeEventListener('resize', updateLines)
  }, [])

  // Get latest growth record with weight and height separately
  const latestWeightRecord = records?.find(record => record.weight !== null && record.weight !== undefined)
  const latestHeightRecord = records?.find(record => record.height !== null && record.height !== undefined)
  
  // Get recent milestones (latest 3)
  const recentMilestones = milestones?.slice(0, 4) || []

  // Prepare chart data - 使用真实的时间戳作为X轴
  const chartData = records?.map(record => ({
    date: new Date(record.date).getTime(), // 使用时间戳
    dateFormatted: new Date(record.date).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
    fullDate: record.date,
    体重: record.weight || null,
    身高: record.height || null,
  })).reverse() || [] // 反转数组以按时间正序显示

  // 计算Y轴的动态范围
  const calculateAxisDomain = (dataKey: '体重' | '身高', buffer = 0.1) => {
    const values = chartData
      .map(item => item[dataKey])
      .filter(value => value !== null && value !== undefined) as number[]
    
    if (values.length === 0) return ['dataMin', 'dataMax']
    
    const minValue = Math.min(...values)
    const maxValue = Math.max(...values)
    const range = maxValue - minValue
    
    // 如果数据范围很小，给一个最小缓冲区
    const minBuffer = Math.max(range * buffer, 0.5)
    
    return [
      Math.max(0, minValue - minBuffer), // 确保不为负数
      maxValue + minBuffer
    ]
  }

  const weightDomain = calculateAxisDomain('体重', 0.15)
  const heightDomain = calculateAxisDomain('身高', 0.05)

  if (babyLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500 mx-auto mb-4"></div>
          <p className="text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  if (!baby) {
    return (
      <div className="text-center py-12">
        <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
          <Baby className="w-10 h-10 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-text-primary mb-4">欢迎使用宝宝成长记录</h2>
        <p className="text-text-secondary mb-6">开始记录宝宝的成长足迹吧！</p>
        <button 
          onClick={() => setActiveTab('baby')}
          className="btn-primary"
        >
          添加宝宝信息
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="max-w-7xl mx-auto">
        {/* 统一的顶部卡片网格 */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-4 lg:gap-6">
          {/* 宝宝信息卡片 - 占据更多空间 */}
          <div className="col-span-2 md:col-span-3 lg:col-span-2">
            <div className="card p-3 md:p-4 h-full bg-gradient-to-br from-teal-50 to-cyan-50">
              <div className="flex items-center gap-3 md:gap-4 h-full">
                <div className="w-14 h-14 md:w-20 md:h-20 flex-shrink-0">
                  {baby.avatar ? (
                    <Image
                      src={baby.avatar}
                      alt="宝宝头像"
                      width={80}
                      height={80}
                      className="w-14 h-14 md:w-20 md:h-20 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-14 h-14 md:w-20 md:h-20 bg-gradient-to-br from-teal-400 to-teal-600 rounded-full flex items-center justify-center text-white text-2xl md:text-3xl">
                      {baby.gender === 'boy' ? '👦' : '👧'}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="text-base md:text-xl font-bold text-text-primary truncate mb-0.5">{baby.name}</h1>
                  <p className="text-text-secondary text-sm md:text-base mb-0.5">{currentAge}</p>
                  <p className="text-xs md:text-sm text-primary font-medium mb-1 md:mb-2 flex items-center gap-1">
                    已经 {currentDays} 天了 <Sparkles className="w-4 h-4 inline" />
                  </p>
                  <button 
                    onClick={() => setActiveTab('baby')}
                    className="text-xs md:text-sm text-teal-600 hover:text-teal-800 font-medium"
                  >
                    编辑信息 →
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 体重卡片 */}
          <div className="card p-4 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-900/20 min-h-[60px] md:min-h-[80px] lg:min-h-[100px]">
            <div className="flex flex-col items-center text-center h-full justify-center">
              <div className="w-12 h-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-600 flex items-center justify-center text-white mb-3">
                <Scale className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-medium text-text-secondary mb-2">最新体重</h3>
              <p className="text-base font-bold text-text-primary">{latestWeightRecord?.weight ? `${latestWeightRecord.weight} kg` : '暂无数据'}</p>
              <button 
                onClick={() => setActiveTab('growth')}
                className="text-xs text-orange-600 hover:text-orange-800 font-medium mt-1"
              >
                查看成长记录 →
              </button>
            </div>
          </div>

          {/* 身高卡片 */}
          <div className="card p-4 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-900/20 min-h-[60px] md:min-h-[80px] lg:min-h-[100px]">
            <div className="flex flex-col items-center text-center h-full justify-center">
              <div className="w-12 h-12 rounded-full bg-gradient-to-r from-green-500 to-green-600 flex items-center justify-center text-white mb-3">
                <Ruler className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-medium text-text-secondary mb-2">最新身高</h3>
              <p className="text-base font-bold text-text-primary">{latestHeightRecord?.height ? `${latestHeightRecord.height} cm` : '暂无数据'}</p>
              <button 
                onClick={() => setActiveTab('growth')}
                className="text-xs text-orange-600 hover:text-orange-800 font-medium mt-1"
              >
                查看成长记录 →
              </button>
            </div>
          </div>

          {/* 记录数卡片 */}
          <div className="card p-4 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800/50 dark:to-slate-700/50 min-h-[60px] md:min-h-[80px] lg:min-h-[100px]">
            <div className="flex flex-col items-center text-center h-full justify-center">
              <div className="w-12 h-12 rounded-full bg-gradient-to-r from-teal-500 to-teal-600 flex items-center justify-center text-white mb-3">
                <Trophy className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-medium text-text-secondary mb-2">记录数</h3>
              <p className="text-base font-bold text-text-primary">{milestones?.length || 0} 个</p>
              <button 
                onClick={() => setActiveTab('milestones')}
                className="text-xs text-orange-600 hover:text-orange-800 font-medium mt-1"
              >
                查看记录 →
              </button>
            </div>
          </div>

          {/* 新增：图片数量卡片 */}
          <div className="card p-4 bg-gradient-to-br from-orange-50 to-red-100 dark:from-orange-900/20 dark:to-red-900/20 min-h-[60px] md:min-h-[80px] lg:min-h-[100px]">
            <div className="flex flex-col items-center text-center h-full justify-center">
              <div className="w-12 h-12 rounded-full bg-gradient-to-r from-orange-500 to-red-600 flex items-center justify-center text-white mb-3">
                <Camera className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-medium text-text-secondary mb-2">图片数量</h3>
              <p className="text-base font-bold text-text-primary">{baby._count?.mediaItems || 0} 张</p>
              <button 
                onClick={() => setActiveTab('photos')}
                className="text-xs text-orange-600 hover:text-orange-800 font-medium mt-1"
              >
                查看相册 →
              </button>
            </div>
          </div>
        </div>

        {/* 下方左右布局 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 左下角：最近里程碑 */}
          <div className="card p-6 bg-gradient-to-br from-amber-50 to-orange-50 min-h-[400px]">
            {milestonesLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500 mx-auto mb-3"></div>
                <p className="text-base text-gray-600">加载中...</p>
              </div>
            ) : recentMilestones.length > 0 ? (
              <div className="space-y-3 mb-4 flex-1">
                {recentMilestones.map((milestone) => (
                  <div key={milestone.id} className="flex items-start space-x-4 p-4 bg-white/70 dark:bg-slate-700/70 backdrop-blur-sm rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 min-w-0">
                        <span className="font-medium text-gray-800 text-base truncate">
                          {milestone.title}
                        </span>
                        {milestone.tags.slice(0, 4).map((tag, index) => (
                          <span key={index} className="shrink-0 text-[11px] bg-amber-200/70 text-amber-800 px-2 py-0.5 rounded-full">
                            #{tag}
                          </span>
                        ))}
                        {milestone.tags.length > 4 && (
                          <span className="shrink-0 text-xs text-gray-500">+{milestone.tags.length - 2}</span>
                        )}
                        <span className="ml-auto text-sm text-gray-500 whitespace-nowrap">
                          {new Date(milestone.date).toLocaleDateString()}
                        </span>
                      </div>
                      {milestone.description && (
                        <p
                          className="text-sm text-gray-600 mb-2"
                          style={{ WebkitLineClamp: descLines as unknown as string, WebkitBoxOrient: 'vertical', overflow: 'hidden', display: '-webkit-box' }}
                        >
                          {milestone.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 flex-1 flex flex-col justify-center">
                <EmptyMilestones className="w-32 h-24 mx-auto mb-4" />
                <p className="text-base mb-2 text-text-secondary">还没有记录</p>
                <p className="text-sm text-text-muted">记录宝宝的重要成长时刻</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => {
                  try { if (typeof window !== 'undefined') { sessionStorage.setItem('openMilestoneForm', '1') } } catch {}
                  setActiveTab('milestones')
                }}
                className="btn-secondary bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-500 hover:bg-amber-50 dark:hover:bg-slate-600 py-3"
              >
                增加记录
              </button>
              <button 
                onClick={() => setActiveTab('milestones')}
                className="btn-primary bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 border-0 py-3"
              >
                查看全部
              </button>
            </div>
          </div>

          {/* 右下角：成长记录图表 */}
          <div className="card p-6 bg-gradient-to-br from-emerald-50 via-cyan-50 to-teal-50 min-h-[400px] flex flex-col shadow-lg">
            {chartData.length > 0 ? (
              <div className="flex-1">
                <div className="h-80 bg-white/80 dark:bg-slate-700/80 backdrop-blur-sm rounded-xl p-4 shadow-inner">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#34d399" opacity={0.3} />
                      <XAxis 
                        dataKey="date" 
                        type="number"
                        scale="time"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={(timestamp) => {
                          const date = new Date(timestamp);
                          return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
                        }}
                        tick={{ fontSize: 12, fill: '#374151', fontWeight: '500' }}
                        stroke="#6b7280"
                        strokeWidth={2}
                      />
                      <YAxis 
                        yAxisId="weight"
                        orientation="left"
                        domain={weightDomain}
                        tick={{ fontSize: 12, fill: '#374151', fontWeight: '500' }}
                        tickFormatter={(val) => {
                          const num = Number(val)
                          return Number.isFinite(num) ? (Math.round(num * 10) / 10).toString() : ''
                        }}
                        stroke="#0891b2"
                        strokeWidth={2}
                        label={{ value: '体重(kg)', angle: -90, position: 'insideLeft', style: { fontSize: '13px', fill: '#0891b2', fontWeight: 'bold' } }}
                      />
                      <YAxis 
                        yAxisId="height"
                        orientation="right"
                        domain={heightDomain}
                        tick={{ fontSize: 12, fill: '#374151', fontWeight: '500' }}
                        tickFormatter={(val) => {
                          const num = Number(val)
                          return Number.isFinite(num) ? Math.round(num).toString() : ''
                        }}
                        stroke="#059669"
                        strokeWidth={2}
                        label={{ value: '身高(cm)', angle: 90, position: 'insideRight', style: { fontSize: '13px', fill: '#059669', fontWeight: 'bold' } }}
                      />
                      <Tooltip 
                        labelFormatter={(timestamp) => {
                          const date = new Date(timestamp);
                          return `📅 日期: ${date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })}`;
                        }}
                        formatter={(value: unknown, name: string) => [
                          (typeof value === 'number' && value !== null) ? `${value} ${name === '体重' ? 'kg' : 'cm'}` : '无数据',
                          name === '体重' ? '⚖️ 体重' : '📏 身高'
                        ]}
                        contentStyle={{
                          backgroundColor: 'rgba(255, 255, 255, 0.98)',
                          border: '2px solid #10b981',
                          borderRadius: '12px',
                          fontSize: '14px',
                          fontWeight: '500',
                          boxShadow: '0 10px 25px rgba(16, 185, 129, 0.2)'
                        }}
                        labelStyle={{ color: '#374151', fontWeight: 'bold' }}
                      />
                      <Legend 
                        wrapperStyle={{ 
                          fontSize: '14px', 
                          fontWeight: '600',
                          paddingTop: '10px'
                        }} 
                        iconType="rect"
                      />
                      <Line
                        yAxisId="weight"
                        type="monotone"
                        dataKey="体重"
                        stroke="#0891b2"
                        strokeWidth={4}
                        dot={{ fill: '#0891b2', strokeWidth: 3, r: 6, stroke: '#ffffff' }}
                        activeDot={{ r: 8, fill: '#0891b2', stroke: '#ffffff', strokeWidth: 3 }}
                        connectNulls={false}
                      />
                      <Line
                        yAxisId="height"
                        type="monotone"
                        dataKey="身高"
                        stroke="#059669"
                        strokeWidth={4}
                        dot={{ fill: '#059669', strokeWidth: 3, r: 6, stroke: '#ffffff' }}
                        activeDot={{ r: 8, fill: '#059669', stroke: '#ffffff', strokeWidth: 3 }}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {/* 添加一些统计信息 */}
                <div className="mt-6 grid grid-cols-2 gap-4">
                  <div className="bg-gradient-to-r from-blue-100 to-cyan-100 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-blue-800">记录天数</span>
                      <span className="text-lg font-bold text-blue-600">{chartData.length} 天</span>
                    </div>
                  </div>
                  <div className="bg-gradient-to-r from-green-100 to-emerald-100 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-green-800">最新记录</span>
                      <span className="text-lg font-bold text-green-600">
                        {new Date(chartData[chartData.length - 1]?.fullDate).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col justify-center">
                <div className="text-center py-16 bg-card-bg/80 backdrop-blur-sm rounded-xl shadow-inner">
                  <div className="mb-6">
                    <div className="w-16 h-16 mx-auto mb-2 rounded-full bg-primary/10 flex items-center justify-center">
                      <BarChart3 className="w-8 h-8 text-primary" />
                    </div>
                    <div className="w-16 h-1 bg-gradient-to-r from-emerald-400 to-teal-400 rounded mx-auto"></div>
                  </div>
                  <h4 className="text-lg font-bold text-text-primary mb-3">开始记录成长数据</h4>
                  <p className="text-text-secondary text-base mb-2">还没有成长记录</p>
                  <p className="text-sm text-text-muted">添加至少2条记录即可查看美丽的成长趋势图</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
} 