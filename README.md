# 宝宝成长记录 Web 应用

一个沿用 Next.js 16 App Router + React 19 + TypeScript + Tailwind CSS 的宝宝成长记录应用。

> **Cloudflare 迁移分支**：Web/API 已接入 vinext Workers + D1 + 私有 R2，独立微信桥接保持不变。当前为隔离测试环境，未切生产；视频转码和完整跨浏览器/UI 验收尚未完成。架构、实际测试证据、可重复数据迁移、生产冻结/备份/切换/回滚见 [Cloudflare 迁移手册](docs/CLOUDFLARE_MIGRATION.md)；用例/版本/费用/Go-No-Go 见 [验收报告](docs/CLOUDFLARE_ACCEPTANCE_REPORT.md)，生产门禁见 [生产准备与回滚门禁](docs/CLOUDFLARE_PRODUCTION_OPERATIONS.md)。本分支 `build` 生成 Worker 产物，旧 Vercel/Neon 的部署回滚应使用原分支，不应运行旧的 `db:push`/`db:reset`。

## 🌟 功能特色

### 📊 数据管理
- **宝宝信息管理**：记录宝宝的基本信息（姓名、出生日期、性别、血型等）
- **成长记录追踪**：记录身高、体重、头围等关键成长指标
- **里程碑记录**：记录宝宝的重要成长里程碑和特殊时刻
- **媒体相册**：支持照片和视频上传，包括HEIC格式自动转换
- **智能数据显示**：分别显示最新体重和最新身高记录，无需在同一条记录中

### 🎨 用户体验优化
- **媒体编辑功能**：支持直接编辑照片和视频的标题和描述
- **自适应媒体显示**：根据图片和视频的实际尺寸动态调整浏览容器大小
- **优雅删除确认**：使用自定义模态框替代原生浏览器对话框
- **统一年龄计算**：所有页面的宝宝年龄计算保持一致（不计算出生当天）
- **智能Toast提示**：统一的成功/错误反馈系统

### 📈 可视化图表
- **成长曲线图**：使用 Recharts 展示宝宝的成长趋势
- **数据统计**：显示记录天数、最新记录等统计信息
- **交互式图表**：支持悬停查看详细数据

### 🚀 技术特性
- **智能预加载**：优化用户体验，提前加载可能访问的页面
- **响应式设计**：完美适配移动端和桌面端
- **实时数据更新**：使用 React Hooks 进行状态管理
- **云端存储**：集成 Cloudflare R2 对象存储服务
- **HEIC 支持**：自动转换苹果设备的 HEIC 格式照片
- **媒体优化**：智能图片压缩和视频缩略图生成

### 💾 数据持久化
- **PostgreSQL 数据库**：使用 Neon 云数据库服务
- **Prisma ORM**：类型安全的数据库操作
- **智能缓存**：优化数据获取性能

## 🔧 技术栈
- **前端框架**：Next.js 15 + React 19
- **类型系统**：TypeScript
- **样式框架**：Tailwind CSS
- **数据库 ORM**：Prisma
- **云数据库**：Neon (PostgreSQL)
- **状态管理**：React Hooks + Custom Hooks
- **部署平台**：Vercel (推荐)/ local
- **对象存储**: Cloudflare R2
- **图表库**：Recharts
- **文件处理**：Sharp (图片处理)、FFmpeg (视频处理)

## 📋 环境要求

- Node.js 18.0.0 或更高版本
- npm 或 yarn 包管理器
- PostgreSQL 数据库（推荐使用 [Neon](https://neon.tech)）
- Cloudflare R2 账号（用于文件存储）
- FFmpeg（可选，用于视频封面生成）

## 🚀 快速开始

```bash
# 1. 克隆项目
git clone https://github.com/zhajiahe/my-baby.git
cd my-baby

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp env.example .env
# 编辑 .env 文件，填入数据库和 R2 配置

# 4. 初始化数据库
npm run db:generate
npm run db:push

# 5. 生成本地家庭登录凭证（0600 .env.local，不输出密码；已有文件需手工合并）
npm run auth:setup
# 私下读取 .env.local 中的家庭密码以登录，勿提交凭证

# 6. 启动开发服务器
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000) 查看应用。

📖 **详细开发和部署指南请参考 [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)**

📋 **微信 ClawBot：[Cloudflare 实施计划](./docs/WEIXIN_CLAWBOT_PLAN.md) · [Worker 操作指南](./weixin/README.md) · [核验记录](./docs/WEIXIN_CLAWBOT_VALIDATION.md)**（阶段 A 扫码与真实文字收发、人工切换后的恢复已通过；24/72 小时观测仍待完成）

🔐 **[家庭密码登录与 Agent API](./docs/AGENT_V1.md)**：阶段 B 本地实现及临时 PostgreSQL 真实事务/并发测试已通过，未上线；原页面/API 需要服务端密码与会话 Secret，未配置时拒绝访问。可用 `npm run test:postgres` 创建全新 loopback 临时库运行集成测试，不使用现有 Neon 或应用 DATABASE_URL。

## 📝 可用脚本

- `npm run dev` - 启动开发服务器
- `npm run build` - 构建生产版本
- `npm run start` - 启动生产服务器
- `npm run lint` - 运行代码检查
- `npm run db:generate` - 生成 Prisma 客户端
- `npm run db:push` - 推送数据库结构变更
- `npm run db:studio` - 打开 Prisma Studio 数据库管理界面
- `npm run db:seed` - 填充初始数据
- `npm run db:reset` - 重置数据库并填充初始数据

## 🗂️ 项目结构

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API 路由
│   │   ├── baby/          # 宝宝信息 API
│   │   ├── growth-records/ # 成长记录 API
│   │   ├── milestones/    # 里程碑 API
│   │   └── photos/        # 照片上传 API
│   ├── components/        # 页面级组件
│   └── globals.css        # 全局样式
├── components/            # 可复用组件
│   ├── ui/               # UI 基础组件
│   └── providers/        # Context 提供者
├── hooks/                # 自定义 React Hooks
└── lib/                  # 工具函数和配置
prisma/
├── schema.prisma         # 数据库模式
└── seed.ts              # 数据库种子文件
```

## ✨ 功能详细说明

### 📷 媒体管理增强
**媒体编辑功能**
- 📸 点击任意媒体项目进入详情浏览
- ✏️ 在详情模态框中点击"编辑"按钮
- 🔄 实时编辑标题和描述，无需页面刷新
- 💾 一键保存，智能错误处理

**自适应媒体显示**
- 📐 根据图片/视频实际尺寸动态调整浏览器容器
- 🖼️ 横图和竖图都能最佳展示
- 📱 响应式设计，完美适配各种屏幕
- 📊 显示媒体的真实像素尺寸信息

### 📈 成长记录优化
**智能数据显示**
- ⚖️ 最新体重：自动查找最近的体重记录
- 📏 最新身高：自动查找最近的身高记录
- 🔄 无需强制在同一条记录中包含所有数据
- 📊 更准确的数据展示逻辑

**删除体验优化**
- 🗑️ 自定义删除确认模态框
- ⏳ 删除过程中的加载状态显示
- 🔒 删除期间禁用其他操作
- ✅ Toast 提示替代原生浏览器 alert

### ⏰ 年龄计算统一
**准确的年龄计算**
- 📅 所有页面（首页、成长记录、媒体库、里程碑）统一算法
- 🚫 不计算出生当天（减去1天）
- 🎂 出生当天显示"出生当天"
- 📊 精确的天数、月数、年数计算

**应用页面覆盖**
- 🏠 首页Dashboard：宝宝卡片年龄
- 📊 成长记录：记录时的宝宝年龄
- 📸 媒体库：每张照片/视频对应的年龄
- 🏆 里程碑：每个里程碑时的年龄

## 🔧 配置说明

### 数据库配置
项目使用 PostgreSQL 数据库，推荐使用 [Neon](https://neon.tech) 云数据库服务。数据模型包括：
- `Baby` - 宝宝基本信息
- `GrowthRecord` - 成长记录
- `Milestone` - 里程碑记录
- `MediaItem` - 媒体文件记录

### 存储配置 (前提是有一个公共域名，才能实现图像/视频公开访问)
使用 Cloudflare R2 进行文件存储，支持：
- 图片自动压缩和格式转换
- HEIC 格式自动转换为 JPEG
- 视频缩略图生成
- 预签名 URL 安全上传

### 📦 Cloudflare R2 配置指南

#### 1. 创建 Cloudflare 账号
访问 [Cloudflare Dashboard](https://dash.cloudflare.com/) 并创建账号

#### 2. 创建 R2 存储桶
1. 在 Cloudflare Dashboard 中，选择 **R2 Object Storage**
2. 点击 **Create bucket** 创建新的存储桶
3. 输入存储桶名称（例如：`my-baby-photos`）
4. 选择合适的位置（推荐选择离用户最近的区域）
5. 点击 **Create bucket**

#### 3. 生成 API 令牌
1. 在 Cloudflare Dashboard 中，点击右上角的用户头像
2. 选择 **My Profile** > **API Tokens**
3. 点击 **Create Token**
4. 选择 **Custom token** 模板
5. 配置权限：
   - **Account** - `Cloudflare R2:Edit`
   - **Zone Resources** - 选择你的账号
6. 点击 **Continue to summary** 然后 **Create Token**
7. **重要**：复制并安全保存生成的令牌

#### 4. 获取 R2 API 凭据
1. 回到 R2 Overview 页面
2. 在右侧边栏点击 **Manage R2 API tokens**
3. 点击 **Create API token**
4. 配置权限：
   - **Permissions**: `Admin Read & Write`
   - **Specify bucket**: 选择你创建的存储桶
5. 点击 **Create API token**
6. 复制 **Access Key ID** 和 **Secret Access Key**

#### 5. 配置自定义域名（可选但推荐）
1. 在存储桶详情页面，点击 **Settings** 标签
2. 在 **Public access** 部分，点击 **Connect Domain**
3. 输入你的自定义域名（例如：`cdn.yourdomain.com`）
4. 按照说明在你的 DNS 提供商处添加 CNAME 记录
5. 等待 DNS 传播完成（通常需要几分钟到几小时）

#### 6. 环境变量配置示例
```env
# 从 R2 API tokens 页面获取
R2_ACCESS_KEY_ID="your_access_key_id_here"
R2_SECRET_ACCESS_KEY="your_secret_access_key_here"

# 从你的账号信息获取
R2_ACCOUNT_ID="your_cloudflare_account_id"

# 你创建的存储桶名称
R2_BUCKET_NAME="my-baby-photos"

# R2 端点格式
R2_ENDPOINT="https://your_account_id.r2.cloudflarestorage.com"

# 你配置的自定义域名（如果有）
R2_PUBLIC_DOMAIN="https://cdn.yourdomain.com"

# API 令牌（从步骤3获取）
R2_TOKEN="your_api_token_here"
```


## 🚀 部署

### Vercel 部署（推荐）

Vercel 是 Next.js 官方托管平台，提供最佳部署体验：

1. 将代码推送到 GitHub
2. 在 [Vercel](https://vercel.com) 中导入项目
3. 配置环境变量，包括 `MYBABY_APP_PASSWORD` 和 `MYBABY_SESSION_SECRET`；强密码和会话 Secret 不使用 `NEXT_PUBLIC_` 前缀。未配置时站点拒绝访问。
4. 审查 [家庭登录与 Agent API 上线门槛](./docs/AGENT_V1.md)，再允许自动部署；Agent 写入默认关闭。
5. 自动部署完成

📖 **详细部署步骤请参考 [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md#vercel-部署)**

### 本地部署

```bash
npm run build
npm run start
```

## 📄 License

This project is licensed under the MIT License.

## 📋 更新日志

### 🆕 最新更新 (2025年11月)

#### ✨ 新增功能
- **批量媒体上传**：支持一次选择多个文件上传，支持拖拽上传
- **标题可选**：媒体文件标题现在是可选的，方便快速上传
- **视频封面自动生成**：上传视频时后端自动使用 FFmpeg 提取第一帧作为封面
- **圣诞彩蛋** 🎄：11月30日-12月31日期间，每天首次访问显示圣诞树动画
- **暗黑模式**：完整支持系统暗黑模式，自动适配

#### 📱 移动端优化
- **底部Tab导航**：移动端采用底部导航栏，更符合使用习惯
- **响应式布局**：优化所有页面在移动端的显示效果
- **iPhone 安全区域**：适配 iPhone X 及以上设备的底部安全区域
- **字体和间距**：针对移动端优化字体大小和元素间距

#### ♻️ 代码优化
- **可复用 UI 组件库**：新增 Loading、EmptyState、Modal、StatCard 等通用组件
- **CSS 变量系统**：使用 CSS 变量统一管理颜色，便于主题切换
- **文件大小限制**：单文件上传限制提升至 200MB
- **配色升级**：从粉紫色系更换为更高级的青绿色(Teal)配色

---

### 📦 历史更新 (2025年7月)

#### ✨ 新增功能
- **媒体编辑系统**：支持在线编辑照片和视频的标题、描述
- **自适应媒体浏览**：根据媒体实际尺寸智能调整显示容器
- **智能数据分离**：最新体重和身高分别从对应的最新记录中获取

#### 🔧 体验优化
- **模态框透明度修复**：统一所有模态框背景透明度，解决部分页面黑色背景问题
- **布局一致性提升**：成长记录页面标题布局与里程碑页面保持一致
- **删除确认升级**：使用优雅的自定义模态框替代浏览器原生对话框
- **加载状态完善**：删除、保存等操作增加视觉反馈和按钮禁用状态
- **Toast消息系统**：统一的成功/错误提示体验
- **点击外部关闭**：模态框支持点击外部区域关闭功能

#### 🐛 问题修复
- **年龄计算统一**：修正所有页面的宝宝年龄计算逻辑（不计算出生当天）
- **样式一致性**：将 Tailwind CSS 类名改为内联样式，确保跨组件样式一致性
- **代码质量提升**：修复ESLint警告，提高代码健壮性
- **界面文字优化**：将"当前体重/身高"更正为"最新体重/身高"

#### 🎯 技术改进
- **状态管理优化**：改进编辑、删除等交互的状态管理
- **错误处理增强**：完善API调用的错误处理和用户反馈
- **响应式优化**：提升移动端和桌面端的使用体验
- **代码重构**：简化UI结构，注释掉暂时不需要的统计功能
- **事件处理统一**：统一表单重置和删除确认的事件处理逻辑