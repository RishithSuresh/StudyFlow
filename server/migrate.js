import './env.js';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './db.js';

const migrationsDirectory = path.resolve(fileURLToPath(new URL('../db/migrations', import.meta.url)));
const migrationFiles = (await readdir(migrationsDirectory))
  .filter(file => file.endsWith('.sql'))
  .sort();

try {
  for (const migrationFile of migrationFiles) {
    const sql = await readFile(path.join(migrationsDirectory, migrationFile), 'utf8');
    await pool.query(sql);
    console.log(`Applied ${migrationFile}.`);
  }
  console.log('StudyFlow database migration completed.');
} finally {
  await pool.end();
}
