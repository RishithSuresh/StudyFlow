import './env.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './db.js';

const migrationPath = fileURLToPath(new URL('../db/migrations/001_initial.sql', import.meta.url));
const sql = await readFile(path.resolve(migrationPath), 'utf8');

try {
  await pool.query(sql);
  console.log('StudyFlow database migration completed.');
} finally {
  await pool.end();
}
