# 🚀 快速上手指南

## 第一步：启动应用

```bash
# 确保已安装依赖
npm install

# 启动开发服务器
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000)

## 第二步：配置数据库

### 创建 Neon 数据库
1. 访问 [Neon Console](https://console.neon.tech/)
2. 创建新项目
3. 复制数据库连接字符串

### 配置环境变量
```bash
# 创建 .env.local 文件
echo 'DATABASE_URL="your-neon-database-url"' > .env.local
```

### 初始化数据库
```bash
# 生成 Prisma 客户端
npm run db:generate

# 推送数据库架构
npm run db:push

# (可选) 填充示例数据
npm run db:seed
```

## 第三步：开始记录

### 1. 添加宝宝信息
- 打开应用后，如果没有宝宝信息，会提示添加
- 点击"添加宝宝信息"或导航到"宝宝信息"标签
- 填写基本信息：姓名、性别、出生日期等
- 点击"保存"

### 2. 记录第一条成长数据
- 导航到"成长记录"标签
- 点击"添加记录"
- 填写体重、身高、头围等数据
- 添加备注（可选）
- 保存记录

### 3. 记录第一个里程碑
- 导航到"里程碑"标签
- 选择里程碑分类（运动、语言、社交、认知、生活自理）
- 填写里程碑标题和描述
- 选择达成日期
- 保存里程碑

### 4. 写第一篇日记
- 导航到"育儿日记"标签
- 点击"写新日记"
- 填写标题和内容
- 选择心情和天气
- 添加标签（可选）
- 保存日记

## 第四步：查看数据

### 仪表盘概览
返回仪表盘查看：
- 宝宝基本信息和年龄
- 各类记录的统计数据
- 最新里程碑
- 成长趋势（需要至少2条记录）

### 数据管理
每个功能模块都支持：
- ✅ **查看**：浏览所有历史记录
- ✅ **添加**：创建新记录
- ✅ **编辑**：修改现有记录
- ✅ **删除**：删除不需要的记录

## 常用操作

### 编辑记录
1. 在任何列表视图中找到要编辑的记录
2. 点击"编辑"按钮（铅笔图标）
3. 修改信息后保存

### 删除记录
1. 在列表视图中找到要删除的记录
2. 点击"删除"按钮（垃圾桶图标）
3. 确认删除操作

### 快速导航
- 使用顶部导航栏在不同功能间切换
- 在仪表盘使用快速操作按钮（已修复所有跳转问题）
- 点击统计数据跳转到对应模块
- **注意**：所有导航按钮现在都会在应用内正确切换tab，不会导致页面刷新

## 数据备份建议

### 定期备份
```bash
# 使用 Prisma Studio 查看数据
npm run db:studio

# 重置数据库（小心使用）
npm run db:reset
```

### 数据导出（规划中）
未来版本将支持：
- PDF 报告导出
- Excel 数据导出
- 照片批量下载

## 故障排除

### 数据不显示
1. 检查 `.env.local` 文件是否正确配置
2. 确认数据库连接正常：`npm run db:studio`
3. 重新生成客户端：`npm run db:generate`

### 应用无法启动
1. 确保 Node.js 版本 >= 18
2. 重新安装依赖：`rm -rf node_modules && npm install`
3. 检查端口是否被占用

### 页面显示错误
1. 检查浏览器控制台错误信息
2. 刷新页面或清除浏览器缓存
3. 查看终端错误日志

## 需要帮助？

- 📖 查看完整文档：[docs/README.md](docs/README.md)
- 🔧 数据库配置：[NEON_SETUP.md](NEON_SETUP.md)
- 👤 用户指南：[docs/USER_GUIDE.md](docs/USER_GUIDE.md)
- 🔌 API 文档：[docs/API_GUIDE.md](docs/API_GUIDE.md)

## 成功指标

完成以下步骤表示应用配置成功：
- ✅ 应用能够正常启动并访问
- ✅ 数据库连接正常
- ✅ 能够添加和查看宝宝信息
- ✅ 能够添加成长记录、里程碑和日记
- ✅ 仪表盘显示真实数据而非假数据
- ✅ 所有增删改查操作正常工作

**恭喜！您已经成功配置了宝宝成长记录应用，开始记录宝宝的美好时光吧！** 🎉 