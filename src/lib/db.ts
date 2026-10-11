import { repository, type Database } from './d1-repository';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types/index.ts';

// Never fall back to DATABASE_URL. The migrated app only talks to its D1 binding.
export async function bindings() {
 const { env } = await import('cloudflare:workers');
 return env as unknown as { DB: D1Database; MEDIA: R2Bucket; SOURCE_MEDIA?: R2Bucket;
   MIGRATION_TOKEN?: string; MYBABY_UPLOAD_SECRET?: string };
}
export async function database(): Promise<Database> {
 const { DB } = await bindings();
 if (!DB) throw new Error('d1_not_configured');
 return DB.withSession('first-primary') as unknown as Database;
}
function model(name: 'baby'|'growthRecord'|'milestone'|'mediaItem') {
 return {
  findFirst: async (args?: any) => repository(await database())[name].findFirst(args),
  findUnique: async (args: any) => repository(await database())[name].findUnique(args),
  findMany: async (args?: any) => repository(await database())[name].findMany(args),
  count: async (args?: any) => repository(await database())[name].count(args),
  create: async (args: any) => repository(await database())[name].create(args),
  update: async (args: any) => repository(await database())[name].update(args),
  delete: async (args: any) => repository(await database())[name].delete(args),
 };
}
export const db = { baby:model('baby'), growthRecord:model('growthRecord'), milestone:model('milestone'), mediaItem:model('mediaItem'),
 createMediaBatch: async (data: any[]) => repository(await database()).createMediaBatch(data) };
