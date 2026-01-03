'use client'

import { useState, useEffect } from 'react'
import { useBaby } from '@/hooks/useBaby'
import { useToastContext } from '@/components/providers/ToastProvider'
import Image from 'next/image'
import { Baby, X } from 'lucide-react'

export default function BabyInfo() {
  const { baby, loading, error, createBaby, updateBaby } = useBaby()
  const toast = useToastContext()
  const [isEditing, setIsEditing] = useState(false)
  const [showAvatarUpload, setShowAvatarUpload] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [selectedAvatarFile, setSelectedAvatarFile] = useState<File | null>(null)
  const [isAvatarOperation, setIsAvatarOperation] = useState(false)
  
  const [babyInfo, setBabyInfo] = useState({
    name: '',
    gender: 'boy',
    birthDate: '',
    birthTime: '',
    avatar: '',
    birthWeight: '',
    birthHeight: '',
    birthHeadCircumference: '',
    bloodType: '',
    allergies: '',
    notes: ''
  })

  useEffect(() => {
    if (baby) {
      setBabyInfo({
        name: baby.name || '',
        gender: baby.gender || 'boy',
        birthDate: baby.birthDate ? baby.birthDate.split('T')[0] : '',
        birthTime: baby.birthTime || '',
        avatar: baby.avatar || '',
        birthWeight: baby.birthWeight?.toString() || '',
        birthHeight: baby.birthHeight?.toString() || '',
        birthHeadCircumference: baby.birthHeadCircumference?.toString() || '',
        bloodType: baby.bloodType || '',
        allergies: baby.allergies || '',
        notes: baby.notes || ''
      })
      if (isAvatarOperation) {
        setIsAvatarOperation(false)
      }
    } else if (!loading && !baby && !isAvatarOperation) {
      setIsEditing(true)
    }
  }, [baby, loading, isAvatarOperation])

  const handleAvatarUpload = async () => {
    if (!selectedAvatarFile || !baby?.id) return

    setUploadingAvatar(true)
    setIsAvatarOperation(true)
    try {
      const formData = new FormData()
      formData.append('file', selectedAvatarFile)

      const uploadResponse = await fetch('/api/photos/upload', {
        method: 'POST',
        body: formData,
      })

      if (!uploadResponse.ok) {
        throw new Error('头像上传失败')
      }

      const uploadResult = await uploadResponse.json()
      
      await updateBaby({
        id: baby.id,
        avatar: uploadResult.url
      })

      setShowAvatarUpload(false)
      setSelectedAvatarFile(null)
      toast.success('头像更新成功', '头像已成功更新并保存')
    } catch (error) {
      console.error('Avatar upload error:', error)
      toast.error('头像上传失败', '请检查网络连接后重试')
    } finally {
      setUploadingAvatar(false)
      setTimeout(() => {
        setIsAvatarOperation(false)
      }, 1000)
    }
  }

  const handleSave = async () => {
    try {
      if (baby) {
        await updateBaby({
          id: baby.id,
          ...babyInfo,
          birthWeight: babyInfo.birthWeight ? parseFloat(babyInfo.birthWeight) : undefined,
          birthHeight: babyInfo.birthHeight ? parseFloat(babyInfo.birthHeight) : undefined,
          birthHeadCircumference: babyInfo.birthHeadCircumference ? parseFloat(babyInfo.birthHeadCircumference) : undefined,
        })
      } else {
        await createBaby({
          ...babyInfo,
          birthWeight: babyInfo.birthWeight ? parseFloat(babyInfo.birthWeight) : undefined,
          birthHeight: babyInfo.birthHeight ? parseFloat(babyInfo.birthHeight) : undefined,
          birthHeadCircumference: babyInfo.birthHeadCircumference ? parseFloat(babyInfo.birthHeadCircumference) : undefined,
        })
      }
      setIsEditing(false)
      toast.success('保存成功', '宝宝信息已成功保存')
    } catch {
      toast.error('保存失败', '请检查信息后重试')
    }
  }

  const handleChange = (field: string, value: string) => {
    setBabyInfo(prev => ({ ...prev, [field]: value }))
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-teal-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="text-center py-12">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <X className="w-6 h-6 text-red-500" />
          </div>
          <p className="text-red-600">加载失败: {error}</p>
          <p className="text-text-secondary mt-2">
            请确保已正确配置数据库连接，并运行了数据库迁移。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="text-center">
        <h2 className="text-3xl font-bold text-gray-800 mb-2">宝宝信息</h2>
        <p className="text-gray-600">管理宝宝的基本信息</p>
      </div>

      <div className="card">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-gray-800">头像</h3>
          {baby && (
            <button
              onClick={() => setShowAvatarUpload(true)}
              className="btn-secondary"
              disabled={uploadingAvatar || isAvatarOperation}
            >
              {uploadingAvatar ? '上传中...' : '更换头像'}
            </button>
          )}
        </div>

        <div className="flex justify-center">
          <div className="relative w-32 h-32">
            {babyInfo.avatar ? (
              <Image
                src={babyInfo.avatar}
                alt="宝宝头像"
                width={128}
                height={128}
                className="w-32 h-32 rounded-full object-cover border-4 border-teal-200"
              />
            ) : (
              <div className="w-32 h-32 bg-gradient-to-br from-teal-400 to-teal-600 rounded-full flex items-center justify-center text-white text-5xl border-4 border-teal-200">
                {babyInfo.gender === 'boy' ? '👦' : '👧'}
              </div>
            )}
          </div>
        </div>
      </div>

      {showAvatarUpload && (
        <div className="fixed inset-0 bg-black bg-opacity-20 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-800 mb-4">更换头像</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  选择头像图片
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    id="avatar-upload"
                    onChange={(e) => setSelectedAvatarFile(e.target.files ? e.target.files[0] : null)}
                    disabled={uploadingAvatar}
                  />
                  {!selectedAvatarFile ? (
                    <>
                      <div className="w-16 h-16 mx-auto mb-2 rounded-full bg-primary/10 flex items-center justify-center">
                        <Baby className="w-8 h-8 text-primary" />
                      </div>
                      <p className="text-text-secondary mb-2">点击选择头像图片</p>
                      <label
                        htmlFor="avatar-upload"
                        className={`btn-secondary cursor-pointer inline-block ${uploadingAvatar ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        选择图片
                      </label>
                    </>
                  ) : (
                    <div className="text-left">
                      <p className="text-sm text-gray-700">已选择文件:</p>
                      <p className="font-medium text-gray-900 truncate">{selectedAvatarFile.name}</p>
                      <p className="text-xs text-gray-500">大小: {(selectedAvatarFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                      <button
                        onClick={() => setSelectedAvatarFile(null)}
                        className="text-xs text-red-500 hover:text-red-700 mt-1"
                        disabled={uploadingAvatar}
                      >
                        清除选择
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {selectedAvatarFile && (
                <div className="flex justify-center">
                  <Image
                    src={URL.createObjectURL(selectedAvatarFile)}
                    alt="预览"
                    width={96}
                    height={96}
                    className="w-24 h-24 rounded-full object-cover border-2 border-gray-200"
                  />
                </div>
              )}
            </div>

            <div className="flex space-x-3 mt-6">
              <button
                onClick={handleAvatarUpload}
                className="btn-primary flex-1"
                disabled={uploadingAvatar || !selectedAvatarFile}
              >
                {uploadingAvatar ? '上传中...' : '更新头像'}
              </button>
              <button
                onClick={() => {
                  if (uploadingAvatar) return
                  setShowAvatarUpload(false)
                  setSelectedAvatarFile(null)
                }}
                className={`btn-secondary flex-1 ${uploadingAvatar ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={uploadingAvatar}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-gray-800">基本信息</h3>
          <button
            onClick={() => isEditing ? handleSave() : setIsEditing(true)}
            className={isEditing ? 'btn-primary' : 'btn-secondary'}
            disabled={isAvatarOperation}
          >
            {isEditing ? '保存' : '编辑'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              宝宝姓名
            </label>
            {isEditing ? (
              <input
                type="text"
                value={babyInfo.name}
                onChange={(e) => handleChange('name', e.target.value)}
                className="input-field"
              />
            ) : (
              <p className="text-lg text-gray-800">{babyInfo.name || '未设置'}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              性别
            </label>
            {isEditing ? (
              <select
                value={babyInfo.gender}
                onChange={(e) => handleChange('gender', e.target.value)}
                className="input-field"
              >
                <option value="boy">男孩 👦</option>
                <option value="girl">女孩 👧</option>
              </select>
            ) : (
              <p className="text-lg text-gray-800">
                {babyInfo.gender === 'boy' ? '男孩 👦' : '女孩 👧'}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              出生日期
            </label>
            {isEditing ? (
              <input
                type="date"
                value={babyInfo.birthDate}
                onChange={(e) => handleChange('birthDate', e.target.value)}
                className="input-field"
              />
            ) : (
              <p className="text-lg text-gray-800">{babyInfo.birthDate || '未设置'}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              出生时间
            </label>
            {isEditing ? (
              <input
                type="time"
                value={babyInfo.birthTime}
                onChange={(e) => handleChange('birthTime', e.target.value)}
                className="input-field"
              />
            ) : (
              <p className="text-lg text-gray-800">{babyInfo.birthTime || '未设置'}</p>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="text-xl font-bold text-gray-800 mb-6">出生数据</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center p-4 bg-blue-50 rounded-lg">
            <div className="text-3xl mb-2">⚖️</div>
            <div className="text-sm text-gray-600 mb-1">出生体重</div>
            {isEditing ? (
              <input
                type="number"
                step="0.1"
                value={babyInfo.birthWeight}
                onChange={(e) => handleChange('birthWeight', e.target.value)}
                className="input-field text-center"
                placeholder="kg"
              />
            ) : (
              <div className="text-2xl font-bold text-blue-600">
                {babyInfo.birthWeight ? `${babyInfo.birthWeight} kg` : '未设置'}
              </div>
            )}
          </div>

          <div className="text-center p-4 bg-green-50 rounded-lg">
            <div className="text-3xl mb-2">📏</div>
            <div className="text-sm text-gray-600 mb-1">出生身高</div>
            {isEditing ? (
              <input
                type="number"
                value={babyInfo.birthHeight}
                onChange={(e) => handleChange('birthHeight', e.target.value)}
                className="input-field text-center"
                placeholder="cm"
              />
            ) : (
              <div className="text-2xl font-bold text-green-600">
                {babyInfo.birthHeight ? `${babyInfo.birthHeight} cm` : '未设置'}
              </div>
            )}
          </div>

          <div className="text-center p-4 bg-slate-50 rounded-lg">
            <div className="text-3xl mb-2">🔄</div>
            <div className="text-sm text-gray-600 mb-1">出生头围</div>
            {isEditing ? (
              <input
                type="number"
                step="0.1"
                value={babyInfo.birthHeadCircumference}
                onChange={(e) => handleChange('birthHeadCircumference', e.target.value)}
                className="input-field text-center"
                placeholder="cm"
              />
            ) : (
              <div className="text-2xl font-bold text-teal-600">
                {babyInfo.birthHeadCircumference ? `${babyInfo.birthHeadCircumference} cm` : '未设置'}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="text-xl font-bold text-gray-800 mb-6">健康信息</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              血型
            </label>
            {isEditing ? (
              <select
                value={babyInfo.bloodType}
                onChange={(e) => handleChange('bloodType', e.target.value)}
                className="input-field"
              >
                <option value="">选择血型</option>
                <option value="A">A型</option>
                <option value="B">B型</option>
                <option value="AB">AB型</option>
                <option value="O">O型</option>
              </select>
            ) : (
              <p className="text-lg text-gray-800">{babyInfo.bloodType ? `${babyInfo.bloodType}型` : '未设置'}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              过敏信息
            </label>
            {isEditing ? (
              <input
                type="text"
                value={babyInfo.allergies}
                onChange={(e) => handleChange('allergies', e.target.value)}
                className="input-field"
                placeholder="如有过敏请填写"
              />
            ) : (
              <p className="text-lg text-gray-800">
                {babyInfo.allergies || '暂无过敏信息'}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            备注
          </label>
          {isEditing ? (
            <textarea
              value={babyInfo.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              className="input-field"
              rows={3}
              placeholder="关于宝宝的其他信息..."
            />
          ) : (
            <p className="text-lg text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-slate-700 p-4 rounded-lg">
              {babyInfo.notes || '暂无备注'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
} 