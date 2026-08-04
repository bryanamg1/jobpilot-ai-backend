import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../src/config/env.js';
import { getMysqlPool } from '../src/repositories/mysql/mysqlClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '../src/database/migrations');
const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

if (!env.mysqlConfigured) {
  console.log(
    JSON.stringify(
      {
        configured: false,
        pendingMigrations: files,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const pool = getMysqlPool();
await pool.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(255) PRIMARY KEY,
    applied_at DATETIME NOT NULL
  )
`);
const [appliedRows] = await pool.query('SELECT name, applied_at FROM schema_migrations ORDER BY applied_at ASC');
const applied = new Set(appliedRows.map((row) => row.name));
console.log(
  JSON.stringify(
    {
      configured: true,
      appliedMigrations: appliedRows,
      pendingMigrations: files.filter((file) => !applied.has(file)),
    },
    null,
    2,
  ),
);
await pool.end();
