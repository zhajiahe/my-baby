PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS deployment_guard (name TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO deployment_guard VALUES ('environment','mybaby-cloudflare-migration-test');
CREATE TABLE IF NOT EXISTS babies (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, birthDate TEXT NOT NULL, birthTime TEXT, gender TEXT NOT NULL,
 avatar TEXT, birthWeight REAL, birthHeight REAL, birthHeadCircumference REAL, bloodType TEXT, allergies TEXT, notes TEXT,
 createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS growth_records (
 id TEXT PRIMARY KEY, babyId TEXT NOT NULL REFERENCES babies(id) ON DELETE CASCADE, date TEXT NOT NULL,
 weight REAL, height REAL, headCircumference REAL, notes TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS growth_baby_date ON growth_records(babyId,date);
CREATE TABLE IF NOT EXISTS milestones (
 id TEXT PRIMARY KEY, babyId TEXT NOT NULL REFERENCES babies(id) ON DELETE CASCADE, date TEXT NOT NULL,
 title TEXT NOT NULL, description TEXT, tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags) AND json_type(tags)='array'),
 createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS milestones_baby_date ON milestones(babyId,date);
CREATE TABLE IF NOT EXISTS media_items (
 id TEXT PRIMARY KEY, babyId TEXT NOT NULL REFERENCES babies(id) ON DELETE CASCADE, date TEXT NOT NULL,
 title TEXT NOT NULL DEFAULT '', description TEXT, url TEXT NOT NULL, mediaType TEXT NOT NULL CHECK(mediaType IN ('IMAGE','VIDEO')),
 format TEXT, thumbnailUrl TEXT, duration INTEGER, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS media_baby_date ON media_items(babyId,date);
CREATE TABLE IF NOT EXISTS agent_operations (
 id TEXT PRIMARY KEY, source TEXT NOT NULL, botId TEXT NOT NULL, messageId TEXT NOT NULL, operationKey TEXT NOT NULL,
 payloadHash TEXT NOT NULL, result TEXT NOT NULL CHECK(json_valid(result)), createdAt TEXT NOT NULL,
 UNIQUE(source,botId,messageId,operationKey)
);
