import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// 创建优化的 Prisma 客户端
// 注意：Neon 数据库的连接池优化需要在 DATABASE_URL 中配置
// 例如：?connection_limit=10&pool_timeout=30
export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
})

// 在开发环境下复用 Prisma 实例，避免连接池耗尽
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
} 