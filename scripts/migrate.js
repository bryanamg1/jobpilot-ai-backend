import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../src/config/env.js';
import { getMysqlPool } from '../src/repositories/mysql/mysqlClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '../src/database/migrations');

function splitSqlStatements(sql) {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function runMigrations() {
  if (!env.mysqlConfigured) {
    console.log('MySQL is not configured. Skipping migrations.');
    return;
  }

  const pool = getMysqlPool();

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at DATETIME NOT NULL
      )
    `);

    const [appliedRows] = await pool.query(
      'SELECT name FROM schema_migrations',
    );

    const appliedMigrations = new Set(
      appliedRows.map((row) => row.name),
    );

    const migrationFiles = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      if (appliedMigrations.has(file)) {
        console.log(`Skipping already applied migration: ${file}`);
        continue;
      }

      console.log(`Applying migration: ${file}`);

      const migrationPath = path.join(migrationsDir, file);
      const migrationSql = await fs.readFile(migrationPath, 'utf8');
      const statements = splitSqlStatements(migrationSql);

      for (const statement of statements) {
        await pool.query(statement);
      }

      await pool.query(
        `
          INSERT INTO schema_migrations (
            name,
            applied_at
          )
          VALUES (?, NOW())
        `,
        [file],
      );

      console.log(`Applied migration: ${file}`);
    }

    console.log('All migrations completed successfully.');
  } catch (error) {
    console.error('Migration failed.');

    console.error({
      message: error.message,
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
    });

    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await runMigrations();