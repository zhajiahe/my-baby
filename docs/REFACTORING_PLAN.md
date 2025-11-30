# 代码重构计划 📋

> 本文档详细分析了 `my-baby` 项目的现状，并提出全面的重构建议。

## 目录

- [项目现状分析](#项目现状分析)
- [重构优先级](#重构优先级)
- [详细重构计划](#详细重构计划)
  - [1. 组件拆分与优化](#1-组件拆分与优化)
  - [2. 类型系统优化](#2-类型系统优化)
  - [3. API 层重构](#3-api-层重构)
  - [4. 状态管理优化](#4-状态管理优化)
  - [5. 样式系统重构](#5-样式系统重构)
  - [6. 性能优化](#6-性能优化)
  - [7. 错误处理与日志](#7-错误处理与日志)
  - [8. 测试覆盖](#8-测试覆盖)
  - [9. 代码质量工具](#9-代码质量工具)
- [实施路线图](#实施路线图)

---

## 项目现状分析

### 📊 代码统计

| 类别 | 文件数 | 总行数 | 备注 |
|------|--------|--------|------|
| 页面组件 | 6 | ~3,300 | Dashboard, BabyInfo, GrowthRecord, Milestones, PhotoGallery, Navigation |
| API 路由 | 12 | ~800 | baby, growth-records, milestones, photos 相关 |
| 自定义 Hooks | 7 | ~900 | useBaby, usePhotos, useMilestones 等 |
| UI 组件 | 9 | ~600 | Loading, Modal, Toast 等 |
| 工具库 | 1 | ~20 | prisma.ts |
| **总计** | **~35** | **~6,200** | |

### 🔍 主要问题

#### 1. 大型组件问题
- `PhotoGallery.tsx`: **1,024 行** - 包含上传、编辑、删除、展示等所有逻辑
- `GrowthRecord.tsx`: **879 行** - 包含表单、图表、列表等多种功能
- `Milestones.tsx`: **476 行** - 逻辑复杂度较高
- `Dashboard.tsx`: **445 行** - 信息密度大

#### 2. 类型定义分散
- 接口定义散落在各个组件中
- 缺少统一的类型定义文件
- API 响应类型缺乏统一定义

#### 3. 状态管理
- 使用自定义缓存系统 (`useCacheManager`)
- 部分组件状态过于复杂
- 缺少全局状态管理方案

#### 4. 代码重复
- 日期格式化函数在多个文件中重复
- 年龄计算逻辑在多个组件中重复
- API 调用模式重复

#### 5. 缺少测试
- 无单元测试
- 无集成测试
- 无 E2E 测试

---

## 重构优先级

| 优先级 | 任务 | 影响 | 难度 | 预估时间 |
|--------|------|------|------|----------|
| 🔴 P0 | 大型组件拆分 | 高 | 中 | 2-3 天 |
| 🔴 P0 | 类型系统统一 | 高 | 低 | 1 天 |
| 🟡 P1 | 工具函数提取 | 中 | 低 | 0.5 天 |
| 🟡 P1 | API 层标准化 | 中 | 中 | 1 天 |
| 🟢 P2 | 单元测试 | 中 | 中 | 2-3 天 |
| 🟢 P2 | 性能优化 | 中 | 中 | 1-2 天 |
| 🔵 P3 | E2E 测试 | 低 | 高 | 3-5 天 |

---

## 详细重构计划

### 1. 组件拆分与优化

#### 1.1 PhotoGallery 拆分

**现状**: 1,024 行的单一组件

**目标结构**:
```
src/app/components/photos/
├── index.tsx              # 主容器组件
├── PhotoGrid.tsx          # 照片网格展示
├── PhotoUploader.tsx      # 上传组件
│   ├── FileSelector.tsx   # 文件选择
│   ├── UploadProgress.tsx # 上传进度
│   └── FilePreview.tsx    # 文件预览
├── PhotoViewer.tsx        # 照片查看器
│   ├── MediaDisplay.tsx   # 媒体展示
│   └── PhotoEditor.tsx    # 编辑功能
├── PhotoStats.tsx         # 统计信息
└── hooks/
    └── usePhotoUpload.ts  # 上传逻辑抽取
```

**具体拆分**:

```typescript
// src/app/components/photos/PhotoUploader.tsx
interface PhotoUploaderProps {
  isOpen: boolean
  onClose: () => void
  onUploadComplete: (items: MediaItem[]) => void
}

export function PhotoUploader({ isOpen, onClose, onUploadComplete }: PhotoUploaderProps) {
  // 仅包含上传相关逻辑
}

// src/app/components/photos/PhotoGrid.tsx
interface PhotoGridProps {
  items: MediaItem[]
  onItemClick: (item: MediaItem) => void
  groupByMonth?: boolean
}

export function PhotoGrid({ items, onItemClick, groupByMonth = true }: PhotoGridProps) {
  // 仅包含网格展示逻辑
}
```

#### 1.2 GrowthRecord 拆分

**目标结构**:
```
src/app/components/growth/
├── index.tsx              # 主容器
├── GrowthChart.tsx        # 成长曲线图表
├── GrowthForm.tsx         # 添加/编辑表单
├── GrowthList.tsx         # 记录列表
├── GrowthStats.tsx        # 统计卡片
└── DeleteConfirmModal.tsx # 删除确认
```

#### 1.3 Milestones 拆分

**目标结构**:
```
src/app/components/milestones/
├── index.tsx              # 主容器
├── MilestoneForm.tsx      # 表单
├── MilestoneList.tsx      # 列表
├── MilestoneCard.tsx      # 单个卡片
├── TagFilter.tsx          # 标签筛选
└── TagInput.tsx           # 标签输入
```

---

### 2. 类型系统优化

#### 2.1 创建统一类型定义

```
src/types/
├── index.ts        # 统一导出
├── baby.ts         # 宝宝相关类型
├── media.ts        # 媒体相关类型
├── growth.ts       # 成长记录类型
├── milestone.ts    # 里程碑类型
└── api.ts          # API 响应类型
```

**示例**:

```typescript
// src/types/baby.ts
export interface Baby {
  id: string
  name: string
  birthDate: string
  birthTime?: string
  gender: 'boy' | 'girl'
  avatar?: string
  birthWeight?: number
  birthHeight?: number
  birthHeadCircumference?: number
  bloodType?: string
  allergies?: string
  notes?: string
}

export interface BabyWithStats extends Baby {
  _count: {
    growthRecords: number
    milestones: number
    mediaItems: number
  }
}

// src/types/media.ts
export type MediaType = 'IMAGE' | 'VIDEO'

export interface MediaItem {
  id: string
  babyId: string
  date: string
  title: string
  description: string | null
  url: string
  mediaType: MediaType
  format?: string
  thumbnailUrl?: string
  duration?: number
  createdAt: string
  updatedAt: string
}

export interface MediaItemWithAge extends MediaItem {
  age: string  // 计算字段
}

// src/types/api.ts
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number
  page: number
  pageSize: number
}
```

#### 2.2 API 响应类型标准化

```typescript
// src/lib/api-response.ts
export function successResponse<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status })
}

export function errorResponse(error: string, status = 500) {
  return NextResponse.json({ success: false, error }, { status })
}

// 使用示例
export async function GET() {
  try {
    const data = await prisma.baby.findFirst()
    return successResponse(data)
  } catch (error) {
    return errorResponse('Failed to fetch baby', 500)
  }
}
```

---

### 3. API 层重构

#### 3.1 统一 API 结构

```
src/app/api/
├── _lib/
│   ├── response.ts      # 响应工具
│   ├── validation.ts    # 参数验证
│   └── error-handler.ts # 错误处理
├── baby/
│   └── route.ts
├── growth-records/
│   ├── route.ts
│   └── [id]/
│       └── route.ts
├── milestones/
│   ├── route.ts
│   └── [id]/
│       └── route.ts
└── photos/
    ├── route.ts
    ├── batch/
    │   └── route.ts
    ├── upload/
    │   └── route.ts
    └── [id]/
        └── route.ts
```

#### 3.2 添加请求验证

```typescript
// src/app/api/_lib/validation.ts
import { z } from 'zod'  // 需要安装 zod

export const mediaItemSchema = z.object({
  babyId: z.string().min(1, 'Baby ID is required'),
  date: z.string().datetime(),
  title: z.string().optional(),
  description: z.string().optional(),
  url: z.string().url('Invalid URL'),
  mediaType: z.enum(['IMAGE', 'VIDEO']),
  format: z.string().optional(),
  thumbnailUrl: z.string().url().optional(),
  duration: z.number().int().positive().optional(),
})

export const growthRecordSchema = z.object({
  babyId: z.string().min(1),
  date: z.string().datetime(),
  weight: z.number().positive().optional(),
  height: z.number().positive().optional(),
  headCircumference: z.number().positive().optional(),
  notes: z.string().optional(),
})

// 使用示例
export async function POST(request: NextRequest) {
  const body = await request.json()
  const validation = mediaItemSchema.safeParse(body)
  
  if (!validation.success) {
    return errorResponse(validation.error.message, 400)
  }
  
  // 继续处理...
}
```

#### 3.3 统一错误处理

```typescript
// src/app/api/_lib/error-handler.ts
export class ApiError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message)
  }
}

export function handleApiError(error: unknown) {
  console.error('API Error:', error)
  
  if (error instanceof ApiError) {
    return errorResponse(error.message, error.statusCode)
  }
  
  if (error instanceof z.ZodError) {
    return errorResponse(error.errors[0].message, 400)
  }
  
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // 处理 Prisma 特定错误
    if (error.code === 'P2025') {
      return errorResponse('Record not found', 404)
    }
  }
  
  return errorResponse('Internal server error', 500)
}
```

---

### 4. 状态管理优化

#### 4.1 保持现有缓存系统

现有的 `useCacheManager` 设计良好，建议保留并优化：

```typescript
// src/hooks/useCacheManager.ts 优化建议

// 1. 添加类型安全的缓存键
export const CACHE_KEYS = {
  baby: 'baby',
  growthRecords: (babyId: string) => `growth-records-${babyId}`,
  milestones: (babyId: string) => `milestones-${babyId}`,
  photos: (babyId: string) => `photos-${babyId}`,
} as const

// 2. 添加缓存预热
export function prefetchData(babyId: string) {
  // 预加载常用数据
}

// 3. 添加离线支持
export function enableOfflineSupport() {
  // 将缓存同步到 localStorage
}
```

#### 4.2 简化组件状态

```typescript
// 之前：多个 useState
const [isUploading, setIsUploading] = useState(false)
const [uploadError, setUploadError] = useState<string | null>(null)
const [uploadProgress, setUploadProgress] = useState(0)

// 之后：useReducer 或 状态机
interface UploadState {
  status: 'idle' | 'uploading' | 'success' | 'error'
  progress: number
  error: string | null
}

const [uploadState, dispatch] = useReducer(uploadReducer, initialState)
```

---

### 5. 样式系统重构

#### 5.1 CSS 变量系统扩展

```css
/* src/app/globals.css */

:root {
  /* 颜色 */
  --color-primary: #0d9488;
  --color-primary-hover: #14b8a6;
  --color-secondary: #64748b;
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-error: #ef4444;
  
  /* 间距 */
  --spacing-xs: 0.25rem;
  --spacing-sm: 0.5rem;
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  --spacing-xl: 2rem;
  
  /* 圆角 */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  
  /* 阴影 */
  --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px rgb(0 0 0 / 0.1);
  --shadow-lg: 0 10px 15px rgb(0 0 0 / 0.1);
  
  /* 动画时长 */
  --duration-fast: 150ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;
}
```

#### 5.2 组件样式封装

```typescript
// src/components/ui/Button.tsx
import { cva, type VariantProps } from 'class-variance-authority'

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-xl font-medium transition-all',
  {
    variants: {
      variant: {
        primary: 'bg-teal-600 text-white hover:bg-teal-500',
        secondary: 'bg-white border border-slate-200 hover:bg-slate-50',
        danger: 'bg-rose-600 text-white hover:bg-rose-500',
      },
      size: {
        sm: 'px-3 py-1.5 text-sm',
        md: 'px-4 py-2 text-base',
        lg: 'px-6 py-3 text-lg',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
)

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
}

export function Button({ variant, size, loading, children, ...props }: ButtonProps) {
  return (
    <button className={buttonVariants({ variant, size })} disabled={loading} {...props}>
      {loading ? <Spinner /> : children}
    </button>
  )
}
```

---

### 6. 性能优化

#### 6.1 组件懒加载

```typescript
// src/app/page.tsx
import dynamic from 'next/dynamic'

const PhotoGallery = dynamic(
  () => import('./components/PhotoGallery'),
  { 
    loading: () => <LoadingSpinner />,
    ssr: false  // 客户端渲染
  }
)

const GrowthRecord = dynamic(
  () => import('./components/GrowthRecord'),
  { loading: () => <LoadingSpinner /> }
)
```

#### 6.2 图片优化

```typescript
// 使用 Next.js Image 组件的最佳实践
<Image
  src={photo.url}
  alt={photo.title}
  width={500}
  height={500}
  sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
  placeholder="blur"
  blurDataURL="/placeholder.jpg"
  loading="lazy"
/>
```

#### 6.3 虚拟滚动

```typescript
// 对于大量媒体项，使用虚拟滚动
import { useVirtualizer } from '@tanstack/react-virtual'

function VirtualPhotoGrid({ items }: { items: MediaItem[] }) {
  const parentRef = useRef<HTMLDivElement>(null)
  
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    overscan: 5,
  })
  
  // ...
}
```

#### 6.4 API 响应优化

```typescript
// 添加分页
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1')
  const pageSize = parseInt(searchParams.get('pageSize') || '20')
  
  const [items, total] = await prisma.$transaction([
    prisma.mediaItem.findMany({
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { date: 'desc' },
    }),
    prisma.mediaItem.count(),
  ])
  
  return NextResponse.json({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  })
}
```

---

### 7. 错误处理与日志

#### 7.1 错误边界

```typescript
// src/components/ErrorBoundary.tsx
'use client'

import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo)
    // 上报错误到监控服务
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || <DefaultErrorFallback error={this.state.error} />
    }
    return this.props.children
  }
}
```

#### 7.2 日志服务

```typescript
// src/lib/logger.ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  level: LogLevel
  message: string
  data?: unknown
  timestamp: string
}

class Logger {
  private isDev = process.env.NODE_ENV === 'development'
  
  private log(level: LogLevel, message: string, data?: unknown) {
    const entry: LogEntry = {
      level,
      message,
      data,
      timestamp: new Date().toISOString(),
    }
    
    if (this.isDev) {
      console[level](entry)
    } else {
      // 生产环境发送到日志服务
      this.sendToLogService(entry)
    }
  }
  
  debug(message: string, data?: unknown) {
    this.log('debug', message, data)
  }
  
  info(message: string, data?: unknown) {
    this.log('info', message, data)
  }
  
  warn(message: string, data?: unknown) {
    this.log('warn', message, data)
  }
  
  error(message: string, data?: unknown) {
    this.log('error', message, data)
  }
  
  private async sendToLogService(entry: LogEntry) {
    // 发送到 Sentry, LogRocket 等
  }
}

export const logger = new Logger()
```

---

### 8. 测试覆盖

#### 8.1 测试框架配置

```bash
# 安装测试依赖
npm install -D vitest @testing-library/react @testing-library/jest-dom @vitejs/plugin-react jsdom
```

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'src/test/'],
    },
  },
})
```

#### 8.2 单元测试示例

```typescript
// src/hooks/__tests__/useBaby.test.ts
import { renderHook, waitFor } from '@testing-library/react'
import { useBaby } from '../useBaby'

describe('useBaby', () => {
  it('should fetch baby data', async () => {
    const { result } = renderHook(() => useBaby())
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    
    expect(result.current.baby).toBeDefined()
  })
  
  it('should handle errors', async () => {
    // Mock API 错误
    server.use(
      rest.get('/api/baby', (req, res, ctx) => {
        return res(ctx.status(500))
      })
    )
    
    const { result } = renderHook(() => useBaby())
    
    await waitFor(() => {
      expect(result.current.error).toBeDefined()
    })
  })
})
```

#### 8.3 组件测试示例

```typescript
// src/components/ui/__tests__/Modal.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { Modal } from '../Modal'

describe('Modal', () => {
  it('renders when open', () => {
    render(
      <Modal isOpen={true} onClose={() => {}}>
        <p>Modal content</p>
      </Modal>
    )
    
    expect(screen.getByText('Modal content')).toBeInTheDocument()
  })
  
  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn()
    render(
      <Modal isOpen={true} onClose={onClose}>
        <p>Modal content</p>
      </Modal>
    )
    
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(onClose).toHaveBeenCalled()
  })
})
```

#### 8.4 E2E 测试配置

```bash
# 安装 Playwright
npm install -D @playwright/test
npx playwright install
```

```typescript
// e2e/photo-upload.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Photo Upload', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.click('text=照片墙')
  })

  test('should upload a photo', async ({ page }) => {
    await page.click('text=上传媒体文件')
    
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles('./fixtures/test-image.jpg')
    
    await expect(page.locator('text=test-image.jpg')).toBeVisible()
    
    await page.click('text=上传')
    
    await expect(page.locator('text=上传成功')).toBeVisible()
  })
})
```

---

### 9. 代码质量工具

#### 9.1 ESLint 配置增强

```typescript
// eslint.config.mjs
import { FlatCompat } from '@eslint/eslintrc'
import js from '@eslint/js'

const compat = new FlatCompat()

export default [
  js.configs.recommended,
  ...compat.extends('next/core-web-vitals'),
  ...compat.extends('plugin:@typescript-eslint/recommended'),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      'prefer-const': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
]
```

#### 9.2 Prettier 配置

```json
// .prettierrc
{
  "semi": false,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100,
  "bracketSpacing": true,
  "arrowParens": "avoid"
}
```

#### 9.3 Husky + lint-staged

```bash
npm install -D husky lint-staged
npx husky init
```

```json
// package.json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md,css}": ["prettier --write"]
  }
}
```

```bash
# .husky/pre-commit
npx lint-staged
```

---

## 实施路线图

### 第一阶段：基础优化 (1-2 周)

- [ ] 创建类型定义文件 (`src/types/`)
- [ ] 提取工具函数 (`src/lib/utils/`)
- [ ] 添加 ESLint/Prettier 配置
- [ ] 设置 Husky pre-commit hooks

### 第二阶段：组件重构 (2-3 周)

- [ ] 拆分 PhotoGallery 组件
- [ ] 拆分 GrowthRecord 组件
- [ ] 拆分 Milestones 组件
- [ ] 创建更多可复用 UI 组件

### 第三阶段：API 层优化 (1 周)

- [ ] 添加 Zod 验证
- [ ] 统一错误处理
- [ ] 添加 API 文档

### 第四阶段：测试 (2-3 周)

- [ ] 配置 Vitest
- [ ] 编写 Hook 单元测试
- [ ] 编写组件测试
- [ ] 配置 Playwright E2E 测试

### 第五阶段：性能优化 (1 周)

- [ ] 实现组件懒加载
- [ ] 添加虚拟滚动
- [ ] 优化图片加载
- [ ] 添加 API 分页

---

## 总结

本重构计划旨在提升代码质量、可维护性和性能。建议按优先级逐步实施，每完成一个阶段进行代码审查和测试验证。

**预计总工期：6-8 周**（取决于团队规模和现有工作负载）

**关键成功指标：**
- 组件文件平均行数 < 200 行
- 测试覆盖率 > 70%
- Lighthouse 性能评分 > 90
- TypeScript 严格模式无错误

