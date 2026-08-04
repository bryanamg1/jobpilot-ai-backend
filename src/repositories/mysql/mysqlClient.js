import mysql from 'mysql2/promise';
import { env } from '../../config/env.js';

let pool;

export function getMysqlPool() {
  if (!env.mysqlConfigured) {
    throw new Error('MySQL is not configured.');
  }

  if (!pool) {
    pool = mysql.createPool({
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      database: env.MYSQL_DATABASE,
      user: env.MYSQL_USER,
      password: env.MYSQL_PASSWORD,
      ssl: env.MYSQL_SSL === 'true' ? {} : undefined,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }

  return pool;
}