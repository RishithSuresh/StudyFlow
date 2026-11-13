import './env.js';
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Copy .env.example to .env and configure Neon.');
}
if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
  throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters.');
}

const database = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

export const auth = betterAuth({
  database,
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false
  },
  trustedOrigins: [process.env.FRONTEND_ORIGIN || 'http://localhost:5173']
});
