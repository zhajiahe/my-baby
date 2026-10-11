'use client'

import { useState, useMemo } from 'react'
import { useBaby } from '@/hooks/useBaby'
import { useGrowthRecords } from '@/hooks/useGrowthRecords'
import { useToastContext } from '@/components/providers/ToastProvider'
import { Trash2, X } from 'lucide-react'

interface GrowthEntry {
  id: string
  date: string
  weight?: number
  height?: number
  headCircumference?: number
  notes?: string
}

export default function GrowthRecord() {
  const { baby, loading: babyLoading } = useBaby()
  const { records, loading, error, createRecord, updateRecord, deleteRecord } = useGrowthRecords(baby?.id)
  const toast = useToastContext()
  
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingRecord, setEditingRecord] = useState<GrowthEntry | null>(null)
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    weight: '',
    height: '',
    headCircumference: '',
    notes: ''
  })

  // 新增：删除确认状态
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [recordToDelete, setRecordToDelete] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // 日历相关函数
  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  }

  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay()
  }

  const formatDateString = (year: number, month: number, day: number) => {
    return `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
  }

  // 生成日历数据
  const calendarData = useMemo(() => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    const daysInMonth = getDaysInMonth(currentDate)
    const firstDay = getFirstDayOfMonth(currentDate)
    
    const days = []
    
    // 添加上个月的空白天数
    for (let i = 0; i < firstDay; i++) {
      days.push(null)
    }
    
    // 添加当月的天数
    for (let day = 1; day <= daysInMonth; day++) {
      const dateString = formatDateString(year, month, day)
      const record = records.find(r => r.date.split('T')[0] === dateString)
      days.push({
        day,
        dateString,
        record,
        isToday: dateString === new Date().toISOString().split('T')[0]
      })
    }
    
    return days
  }, [currentDate, records])

  // 获取记录按月份分组的统计
  // const monthlyStats = useMemo(() => {
  //   const currentMonthRecords = records.filter(record => {
  //     const recordDate = new Date(record.date)
  //     return recordDate.getFullYear() === currentDate.getFullYear() &&
  //            recordDate.getMonth() === currentDate.getMonth()
  //   })

  //   const weightRecords = currentMonthRecords.filter(r => r.weight).length
  //   const heightRecords = currentMonthRecords.filter(r => r.height).length
  //   const headRecords = currentMonthRecords.filter(r => r.headCircumference).length

  //   return {
  //     totalRecords: currentMonthRecords.length,
  //     weightRecords,
  //     heightRecords,
  //     headRecords,
  //     latestRecord: currentMonthRecords[0]
  //   }
  // }, [records, currentDate])

  const resetForm = () => {
    setFormData({
      date: selectedDate || new Date().toISOString().split('T')[0],
      weight: '',
      height: '',
      headCircumference: '',
      notes: ''
    })
    setEditingRecord(null)
    setShowForm(false)
    setSelectedDate(null)
  }

  const handleSubmit = async () => {
    if (!formData.date) {
      toast.error('验证失败', '请选择记录日期')
      return
    }

    if (!baby?.id) {
      toast.error('验证失败', '请先创建宝宝信息')
      return
    }

    try {
      const recordData = {
        babyId: baby.id,
        date: formData.date,
        weight: formData.weight ? parseFloat(formData.weight) : undefined,
        height: formData.height ? parseFloat(formData.height) : undefined,
        headCircumference: formData.headCircumference ? parseFloat(formData.headCircumference) : undefined,
        notes: formData.notes || undefined,
      }

      if (editingRecord) {
        await updateRecord(editingRecord.id, recordData)
        toast.success('更新成功', '成长记录已更新！')
      } else {
        await createRecord(recordData)
        toast.success('添加成功', '成长记录已添加！')
      }
      
      resetForm()
    } catch (error) {
      console.error('Error saving record:', error)
      const errorMessage = error instanceof Error ? error.message : '操作失败，请重试'
      toast.error('保存失败', errorMessage)
    }
  }

  // 新增：开始删除流程
  const handleStartDelete = (id: string) => {
    setRecordToDelete(id)
    setShowDeleteConfirm(true)
  }

  // 新增：取消删除
  const handleCancelDelete = () => {
    setShowDeleteConfirm(false)
    setRecordToDelete(null)
  }

  // 更新：确认删除
  const handleConfirmDelete = async () => {
    if (!recordToDelete) return
    
    setIsDeleting(true)
    try {
      await deleteRecord(recordToDelete)
      toast.success('删除成功', '成长记录已删除！')
      resetForm()
      setShowDeleteConfirm(false)
      setRecordToDelete(null)
    } catch (error) {
      console.error('Error deleting record:', error)
      const errorMessage = error instanceof Error ? error.message : '删除失败，请重试'
      toast.error('删除失败', errorMessage)
    } finally {
      setIsDeleting(false)
    }
  }

  // 保留原函数名以兼容现有代码，但更新实现
  const handleDelete = (id: string) => {
    handleStartDelete(id)
  }

  const handleDateClick = (dateString: string, record?: GrowthEntry) => {
    setSelectedDate(dateString)
    if (record) {
      // 编辑现有记录
      setEditingRecord(record)
      setFormData({
        date: record.date.split('T')[0],
        weight: record.weight?.toString() || '',
        height: record.height?.toString() || '',
        headCircumference: record.headCircumference?.toString() || '',
        notes: record.notes || ''
      })
    } else {
      // 添加新记录
      setEditingRecord(null)
      setFormData({
        date: dateString,
        weight: '',
        height: '',
        headCircumference: '',
        notes: ''
      })
    }
    setShowForm(true)
  }

  const calculateAge = (date: string) => {
    if (!baby?.birthDate) return '未知'
    
    const birth = new Date(baby.birthDate)
    const recordDate = new Date(date)
    const diffTime = Math.abs(recordDate.getTime() - birth.getTime())
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
  }

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentDate(prev => {
      const newDate = new Date(prev)
      if (direction === 'prev') {
        newDate.setMonth(prev.getMonth() - 1)
      } else {
        newDate.setMonth(prev.getMonth() + 1)
      }
      return newDate
    })
  }

  const goToToday = () => {
    setCurrentDate(new Date())
  }

  if (loading || babyLoading) {
    return (
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ 
            width: '64px', 
            height: '64px', 
            border: '4px solid #e5e7eb', 
            borderTop: '4px solid #3b82f6', 
            borderRadius: '50%', 
            animation: 'spin 1s linear infinite',
            margin: '0 auto'
          }}></div>
          <p style={{ marginTop: '16px', color: '#6b7280' }}>加载中...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto p-6">
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
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '2rem', fontWeight: 'bold', color: '#1f2937', marginBottom: '8px' }}>成长记录日历</h2>
          <p style={{ color: '#6b7280' }}>点击日期添加或查看成长记录</p>
        </div>
        <button
          onClick={() => handleDateClick(new Date().toISOString().split('T')[0])}
          className="btn-primary"
        >
          添加今日记录
        </button>
      </div>

      {/* Monthly Statistics */}
      {/* <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)', padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '6px' }}>📊</div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '2px' }}>本月记录</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#3b82f6' }}>{monthlyStats.totalRecords}</div>
        </div>
        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)', padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '6px' }}>⚖️</div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '2px' }}>体重记录</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#10b981' }}>{monthlyStats.weightRecords}</div>
        </div>
        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)', padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '6px' }}>📏</div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '2px' }}>身高记录</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#8b5cf6' }}>{monthlyStats.heightRecords}</div>
        </div>
        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)', padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '6px' }}>🔄</div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '2px' }}>头围记录</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#f59e0b' }}>{monthlyStats.headRecords}</div>
        </div>
      </div> */}

      {/* Calendar Navigation */}
      <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <button
            onClick={() => navigateMonth('prev')}
            style={{ 
              padding: '12px', 
              background: 'transparent', 
              border: 'none', 
              borderRadius: '8px', 
              cursor: 'pointer',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            ← 上个月
          </button>
          
          <div style={{ textAlign: 'center' }}>
            <h3 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1f2937', margin: 0 }}>
              {currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月
            </h3>
            <button
              onClick={goToToday}
              style={{ 
                fontSize: '0.875rem', 
                color: '#3b82f6', 
                background: 'none', 
                border: 'none', 
                cursor: 'pointer', 
                marginTop: '4px' 
              }}
            >
              回到今天
            </button>
          </div>
          
          <button
            onClick={() => navigateMonth('next')}
            style={{ 
              padding: '12px', 
              background: 'transparent', 
              border: 'none', 
              borderRadius: '8px', 
              cursor: 'pointer',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            下个月 →
          </button>
        </div>

        {/* Calendar Grid */}
        <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', background: 'white' }}>
          {/* Week Headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: '#f3f4f6' }}>
            {['日', '一', '二', '三', '四', '五', '六'].map(day => (
              <div key={day} style={{ 
                padding: '16px', 
                textAlign: 'center', 
                fontSize: '0.875rem', 
                fontWeight: '500', 
                color: '#374151', 
                borderRight: '1px solid #e5e7eb' 
              }}>
                {day}
              </div>
            ))}
          </div>
          
          {/* Calendar Days */}
          {(() => {
            const weeks = []
            for (let i = 0; i < calendarData.length; i += 7) {
              weeks.push(calendarData.slice(i, i + 7))
            }
            return weeks.map((week, weekIndex) => (
              <div key={weekIndex} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                {week.map((dayData, dayIndex) => (
                  <div
                    key={`${weekIndex}-${dayIndex}`}
                    data-testid={dayData ? `growth-day-${dayData.dateString}` : undefined}
                    style={{
                      minHeight: '120px',
                      borderRight: dayIndex < 6 ? '1px solid #e5e7eb' : 'none',
                      borderBottom: weekIndex < weeks.length - 1 ? '1px solid #e5e7eb' : 'none',
                      background: !dayData ? '#f9fafb' : dayData.isToday ? '#dbeafe' : 'white',
                      cursor: dayData ? 'pointer' : 'default',
                      position: 'relative',
                      transition: 'background-color 0.2s'
                    }}
                    onClick={() => dayData && handleDateClick(dayData.dateString, dayData.record)}
                    onMouseEnter={(e) => {
                      if (dayData) e.currentTarget.style.backgroundColor = dayData.isToday ? '#bfdbfe' : '#f0f9ff'
                    }}
                    onMouseLeave={(e) => {
                      if (dayData) e.currentTarget.style.backgroundColor = dayData.isToday ? '#dbeafe' : 'white'
                    }}
                  >
                    {dayData && (
                      <div style={{ padding: '8px', height: '100%', position: 'relative' }}>
                        {/* Day Number */}
                        <div style={{ 
                          fontSize: '0.875rem', 
                          fontWeight: '500', 
                          marginBottom: '4px',
                          color: dayData.isToday ? '#2563eb' : '#374151'
                        }}>
                          {dayData.day}
                        </div>
                        
                        {/* Record Indicators */}
                        {dayData.record ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {dayData.record.weight && (
                              <div style={{ 
                                fontSize: '0.75rem', 
                                background: '#3b82f6', 
                                color: 'white', 
                                padding: '2px 4px', 
                                borderRadius: '4px', 
                                textAlign: 'center',
                                lineHeight: '1.2'
                              }}>
                                ⚖️ {dayData.record.weight}kg
                              </div>
                            )}
                            {dayData.record.height && (
                              <div style={{ 
                                fontSize: '0.75rem', 
                                background: '#10b981', 
                                color: 'white', 
                                padding: '2px 4px', 
                                borderRadius: '4px', 
                                textAlign: 'center',
                                lineHeight: '1.2'
                              }}>
                                📏 {dayData.record.height}cm
                              </div>
                            )}
                            {dayData.record.headCircumference && (
                              <div style={{ 
                                fontSize: '0.75rem', 
                                background: '#8b5cf6', 
                                color: 'white', 
                                padding: '2px 4px', 
                                borderRadius: '4px', 
                                textAlign: 'center',
                                lineHeight: '1.2'
                              }}>
                                🔄 {dayData.record.headCircumference}cm
                              </div>
                            )}
                          </div>
                        ) : (
                          /* Add Record Indicator */
                          <div style={{ 
                            position: 'absolute', 
                            top: 0, 
                            left: 0, 
                            right: 0, 
                            bottom: 0, 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center', 
                            opacity: 0,
                            transition: 'opacity 0.2s',
                            fontSize: '2rem',
                            color: '#60a5fa'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                          onMouseLeave={(e) => e.currentTarget.style.opacity = '0'}
                          >
                            +
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          })()}
        </div>
      </div>

      {/* Add/Edit Record Form */}
      {showForm && (
        <div 
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0, 0, 0, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', zIndex: 50 }}
          onClick={() => {
            resetForm();
          }}
        >
          <div 
            style={{ background: 'white', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '28rem', maxHeight: '90vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0 }}>
                {editingRecord ? '编辑成长记录' : '添加成长记录'}
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {editingRecord && (
                  <button
                    onClick={() => handleDelete(editingRecord.id)}
                    style={{ 
                      color: '#ef4444', 
                      background: 'none', 
                      border: 'none', 
                      padding: '8px', 
                      borderRadius: '4px', 
                      cursor: 'pointer',
                      transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#fef2f2'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    title="删除记录"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
                <button
                  onClick={resetForm}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '40px',
                    height: '40px',
                    background: '#f3f4f6',
                    border: 'none',
                    borderRadius: '50%',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                    color: '#6b7280'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#ef4444';
                    e.currentTarget.style.color = 'white';
                    e.currentTarget.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.15)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#f3f4f6';
                    e.currentTarget.style.color = '#6b7280';
                    e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
                  }}
                  title="关闭"
                >
                  <svg style={{ width: '20px', height: '20px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '8px' }}>
                  记录日期 <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                  style={{ 
                    width: '100%', 
                    padding: '12px', 
                    border: '1px solid #d1d5db', 
                    borderRadius: '8px', 
                    fontSize: '0.875rem',
                    outline: 'none',
                    transition: 'border-color 0.2s'
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = '#ec4899'}
                  onBlur={(e) => e.currentTarget.style.borderColor = '#d1d5db'}
                />
                {baby?.birthDate && (
                  <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '4px' }}>
                    宝宝年龄: {calculateAge(formData.date)}
                  </p>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '8px' }}>
                    体重 (kg) <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>可选</span>
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={formData.weight}
                    onChange={(e) => setFormData(prev => ({ ...prev, weight: e.target.value }))}
                    style={{ 
                      width: '100%', 
                      padding: '12px', 
                      border: '1px solid #d1d5db', 
                      borderRadius: '8px', 
                      fontSize: '0.875rem',
                      outline: 'none',
                      transition: 'border-color 0.2s'
                    }}
                    onFocus={(e) => e.currentTarget.style.borderColor = '#ec4899'}
                    onBlur={(e) => e.currentTarget.style.borderColor = '#d1d5db'}
                    placeholder="例: 7.5"
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '8px' }}>
                    身高 (cm) <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>可选</span>
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={formData.height}
                    onChange={(e) => setFormData(prev => ({ ...prev, height: e.target.value }))}
                    style={{ 
                      width: '100%', 
                      padding: '12px', 
                      border: '1px solid #d1d5db', 
                      borderRadius: '8px', 
                      fontSize: '0.875rem',
                      outline: 'none',
                      transition: 'border-color 0.2s'
                    }}
                    onFocus={(e) => e.currentTarget.style.borderColor = '#ec4899'}
                    onBlur={(e) => e.currentTarget.style.borderColor = '#d1d5db'}
                    placeholder="例: 65"
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '8px' }}>
                  头围 (cm) <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>可选</span>
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.headCircumference}
                  onChange={(e) => setFormData(prev => ({ ...prev, headCircumference: e.target.value }))}
                  style={{ 
                    width: '100%', 
                    padding: '12px', 
                    border: '1px solid #d1d5db', 
                    borderRadius: '8px', 
                    fontSize: '0.875rem',
                    outline: 'none',
                    transition: 'border-color 0.2s'
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = '#ec4899'}
                  onBlur={(e) => e.currentTarget.style.borderColor = '#d1d5db'}
                  placeholder="例: 42"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '8px' }}>
                  备注 <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>可选</span>
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  style={{ 
                    width: '100%', 
                    padding: '12px', 
                    border: '1px solid #d1d5db', 
                    borderRadius: '8px', 
                    fontSize: '0.875rem',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                    resize: 'vertical'
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = '#ec4899'}
                  onBlur={(e) => e.currentTarget.style.borderColor = '#d1d5db'}
                  rows={3}
                  placeholder="记录一些备注信息..."
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button 
                onClick={handleSubmit} 
                style={{ 
                  flex: 1,
                  background: 'linear-gradient(to right, #ec4899, #8b5cf6)', 
                  color: 'white', 
                  padding: '12px 24px', 
                  borderRadius: '8px', 
                  border: 'none', 
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'transform 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
              >
                {editingRecord ? '更新记录' : '添加记录'}
              </button>
              <button 
                onClick={resetForm} 
                style={{ 
                  flex: 1,
                  background: 'white', 
                  color: '#374151', 
                  padding: '12px 24px', 
                  borderRadius: '8px', 
                  border: '1px solid #d1d5db', 
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f9fafb'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div 
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0, 0, 0, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', zIndex: 50 }}
          onClick={() => {
            handleCancelDelete();
          }}
        >
          <div 
            style={{ background: 'white', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '28rem', maxHeight: '90vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0 }}>
                确认删除
              </h3>
              <button
                onClick={handleCancelDelete}
                disabled={isDeleting}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '40px',
                  height: '40px',
                  background: isDeleting ? '#d1d5db' : '#f3f4f6',
                  border: 'none',
                  borderRadius: '50%',
                  cursor: isDeleting ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                  color: isDeleting ? '#9ca3af' : '#6b7280',
                  opacity: isDeleting ? 0.5 : 1
                }}
                onMouseEnter={(e) => {
                  if (!isDeleting) {
                    e.currentTarget.style.background = '#ef4444';
                    e.currentTarget.style.color = 'white';
                    e.currentTarget.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.15)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isDeleting) {
                    e.currentTarget.style.background = '#f3f4f6';
                    e.currentTarget.style.color = '#6b7280';
                    e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
                  }
                }}
                title="关闭"
              >
                <svg style={{ width: '20px', height: '20px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p style={{ color: '#6b7280', marginBottom: '24px' }}>
              确定要删除这条成长记录吗？
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button 
                onClick={handleConfirmDelete} 
                disabled={isDeleting}
                style={{ 
                  flex: 1,
                  background: isDeleting ? '#d1d5db' : 'linear-gradient(to right, #ec4899, #8b5cf6)', 
                  color: 'white', 
                  padding: '12px 24px', 
                  borderRadius: '8px', 
                  border: 'none', 
                  fontWeight: '500',
                  cursor: isDeleting ? 'not-allowed' : 'pointer',
                  transition: 'transform 0.2s',
                  opacity: isDeleting ? 0.7 : 1
                }}
                onMouseEnter={(e) => {
                  if (!isDeleting) {
                    e.currentTarget.style.transform = 'scale(1.02)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isDeleting) {
                    e.currentTarget.style.transform = 'scale(1)'
                  }
                }}
              >
                {isDeleting ? '删除中...' : '确认'}
              </button>
              <button 
                onClick={handleCancelDelete}
                disabled={isDeleting}
                style={{ 
                  flex: 1,
                  background: 'white', 
                  color: '#374151', 
                  padding: '12px 24px', 
                  borderRadius: '8px', 
                  border: '1px solid #d1d5db', 
                  fontWeight: '500',
                  cursor: isDeleting ? 'not-allowed' : 'pointer',
                  transition: 'background-color 0.2s',
                  opacity: isDeleting ? 0.5 : 1
                }}
                onMouseEnter={(e) => {
                  if (!isDeleting) {
                    e.currentTarget.style.backgroundColor = '#f9fafb'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isDeleting) {
                    e.currentTarget.style.backgroundColor = 'white'
                  }
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
} 