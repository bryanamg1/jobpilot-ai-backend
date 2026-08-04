import mysql from 'mysql2/promise';
import { env } from '../../config/env.js';

let pool;

export function getMysqlPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      database: env.MYSQL_DATABASE,
      user: env.MYSQL_USER,
      password: env.MYSQL_PASSWORD,
      ssl: env.MYSQL_SSL === 'true' ? {} : undefined,
      connectionLimit: 5,
    });
  }

  return pool;
}
