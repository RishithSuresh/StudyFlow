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

const configuredOrigins = [
  process.env.FRONTEND_ORIGIN,
  process.env.BETTER_AUTH_URL,
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null,
  'http://localhost:5173',
  'http://localhost:3000'
].filter(Boolean);

export const auth = betterAuth({
  database,
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false
  },
  trustedOrigins: [
    ...configuredOrigins,
    (origin) => !origin || origin.endsWith('.vercel.app') || origin.includes('localhost')
  ]
});
