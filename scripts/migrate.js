import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../src/config/env.js';
import { getMysqlPool } from '../src/repositories/mysql/mysqlClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '../src/database/migrations');

if (!env.mysqlConfigured) {
  console.log('MySQL is not configured. Skipping migrations.');
  process.exit(0);
}

const pool = getMysqlPool();

await pool.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(255) PRIMARY KEY,
    applied_at DATETIME NOT NULL
  )
`);

const [appliedRows] = await pool.query('SELECT name FROM schema_migrations');
const applied = new Set(appliedRows.map((row) => row.name));
const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

for (const file of files) {
  if (applied.has(file)) {
    continue;
  }

  const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
  await pool.query(sql);
  await pool.query('INSERT INTO schema_migrations (name, applied_at) VALUES (?, NOW())', [file]);
  console.log(`Applied ${file}`);
}

await pool.end();
