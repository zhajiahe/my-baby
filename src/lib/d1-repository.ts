// Narrow compatibility repository for the existing API, not a Prisma runtime.
// All identifiers are schema-owned; all values are bound parameters.
export type SQLValue = string | number | null;
export interface Statement {
 bind(...values: SQLValue[]): Statement;
 all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
 first<T = Record<string, unknown>>(): Promise<T | null>;
 run(): Promise<unknown>;
}
export interface Database { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<unknown[]> }
export type Row = Record<string, any>;
const columns = {
 babies: ['id','name','birthDate','birthTime','gender','avatar','birthWeight','birthHeight','birthHeadCircumference','bloodType','allergies','notes','createdAt','updatedAt'],
 growth_records: ['id','babyId','date','weight','height','headCircumference','notes','createdAt','updatedAt'],
 milestones: ['id','babyId','date','title','description','tags','createdAt','updatedAt'],
 media_items: ['id','babyId','date','title','description','url','mediaType','format','thumbnailUrl','duration','createdAt','updatedAt'],
} as const;
export type Table = keyof typeof columns;
interface Args { where?: Row; data?: Row; orderBy?: Row | Row[]; take?: number; skip?: number; select?: Row; include?: Row }
function encode(key: string, value: any): SQLValue {
 if (value === undefined || value === null) return null;
 if (value instanceof Date) return value.toISOString();
 if (key === 'tags') {
   if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) throw new Error('invalid_tags');
   return JSON.stringify(value);
 }
 if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('invalid_value');
 return value;
}
export function newRow(table: Table, data: Row): Row {
 const now = new Date().toISOString();
 const row: Row = { id: crypto.randomUUID(), createdAt: now, updatedAt: now,
   ...(table === 'milestones' ? {tags: []} : {}), ...data };
 for (const key of Object.keys(row)) if (!(columns[table] as readonly string[]).includes(key)) throw new Error('invalid_column');
 return Object.fromEntries(columns[table].map(key => [key, encode(key,row[key])]));
}
export function insert(db: Database, table: Table, row: Row): Statement {
 const keys = columns[table];
 return db.prepare(`INSERT INTO ${table} (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).bind(...keys.map(k=>row[k] ?? null));
}
export function decode(table: Table, row: Row): Row { return table === 'milestones' ? {...row,tags: JSON.parse(row.tags)} : row; }
export function repository(db: Database) {
 function model(table: Table) {
  function where(value: Row = {}) {
   const parts: string[] = [], values: SQLValue[] = [];
   for (const [key,v] of Object.entries(value)) {
    if (!(columns[table] as readonly string[]).includes(key)) throw new Error('invalid_filter');
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      for (const [op,n] of Object.entries(v)) {
       const operators: Record<string,string> = {gte:'>=',gt:'>',lte:'<=',lt:'<'};
       if (!operators[op]) throw new Error('invalid_filter');
       parts.push(`"${key}"${operators[op]}?`); values.push(encode(key,n));
      }
    } else {parts.push(`"${key}"=?`);values.push(encode(key,v));}
   }
   return {sql: parts.length ? ' WHERE '+parts.join(' AND ') : '',values};
  }
  async function project(row: Row, args: Args): Promise<Row> {
   row = decode(table,row);
   if (args.include?.baby) row.baby = await db.prepare('SELECT * FROM babies WHERE id=?').bind(row.babyId).first();
   if (table === 'babies' && args.include?._count) {
    row._count = {};
    for(const [label,child] of [['growthRecords','growth_records'],['milestones','milestones'],['mediaItems','media_items']]) {
      row._count[label] = (await db.prepare(`SELECT COUNT(*) AS n FROM ${child} WHERE babyId=?`).bind(row.id).first<{n:number}>())!.n;
    }
   }
   if (args.select) return Object.fromEntries(Object.keys(args.select).filter(k=>args.select![k]).map(k=>[k,row[k]]));
   return row;
  }
  const api = {
   async findMany(args: Args = {}): Promise<Row[]> {
    const w=where(args.where); const order=Array.isArray(args.orderBy)?args.orderBy:args.orderBy?[args.orderBy]:[];
    const sort=order.flatMap(o=>Object.entries(o).map(([key,direction])=>{
     if (!(columns[table] as readonly string[]).includes(key)||typeof direction !== 'string'||!['asc','desc'].includes(direction)) throw new Error('invalid_order');
     return `"${key}" ${direction.toUpperCase()}`;
    }));
    const take=args.take ?? 10000, skip=args.skip ?? 0;
    if (!Number.isInteger(take)||take<1||take>10000||!Number.isInteger(skip)||skip<0) throw new Error('invalid_pagination');
    const rows=(await db.prepare(`SELECT * FROM ${table}${w.sql}${sort.length?' ORDER BY '+sort.join(','):''} LIMIT ? OFFSET ?`).bind(...w.values,take,skip).all<Row>()).results;
    return Promise.all(rows.map(row=>project(row,args)));
   },
   async findFirst(args: Args = {}): Promise<Row|null> { return (await api.findMany({...args,take:1}))[0]??null; },
   async findUnique(args: Args): Promise<Row|null> { return api.findFirst(args); },
   async count(args: Args = {}): Promise<number> {const w=where(args.where);return (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}${w.sql}`).bind(...w.values).first<{n:number}>())!.n;},
   async create(args: Args): Promise<Row> { const row=newRow(table,args.data!);await insert(db,table,row).run();return project(row,args); },
   async update(args: Args): Promise<Row> {
    const entries=Object.entries({...args.data,updatedAt:new Date().toISOString()}).filter(([,v])=>v!==undefined);
    if(entries.some(([k])=>!(columns[table] as readonly string[]).includes(k)||k==='id'))throw new Error('invalid_column');
    const w=where(args.where);
    const row=await db.prepare(`UPDATE ${table} SET ${entries.map(([k])=>`"${k}"=?`).join(',')}${w.sql} RETURNING *`).bind(...entries.map(([k,v])=>encode(k,v)),...w.values).first<Row>();
    if(!row)throw new Error('not_found');return project(row,args);
   },
   async delete(args: Args): Promise<Row> {const w=where(args.where);const row=await db.prepare(`DELETE FROM ${table}${w.sql} RETURNING *`).bind(...w.values).first<Row>();if(!row)throw new Error('not_found');return decode(table,row);},
  }; return api;
 }
 return {baby:model('babies'),growthRecord:model('growth_records'),milestone:model('milestones'),mediaItem:model('media_items'),
  async createMediaBatch(data: Row[]): Promise<Row[]> {
   if(!data.length||data.length>50)throw new Error('invalid_batch');
   const rows=data.map(value=>newRow('media_items',value));await db.batch(rows.map(row=>insert(db,'media_items',row)));return rows;
  }};
}
