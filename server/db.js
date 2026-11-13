import './env.js';
import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Copy .env.example to .env and configure Neon.');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  ssl: process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

export async function query(text, values) {
  return pool.query(text, values);
}
