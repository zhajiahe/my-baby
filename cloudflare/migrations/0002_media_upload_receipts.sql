CREATE TABLE IF NOT EXISTS media_upload_receipts (
 id TEXT PRIMARY KEY, payloadHash TEXT NOT NULL,
 result TEXT NOT NULL CHECK(json_valid(result)), createdAt TEXT NOT NULL
);
-- Keep receipts after media deletion; retries must report deletion, not resurrect it.
