# StudyFlow

StudyFlow is a multi-user study management workspace built with the existing HTML/CSS/JavaScript frontend, an Express API, Better Auth, and Neon PostgreSQL.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env`.

3. Set `DATABASE_URL` to your Neon PostgreSQL connection string and generate a random `BETTER_AUTH_SECRET` with at least 32 characters.

4. Create the Better Auth and StudyFlow tables:

   ```bash
   npm run db:migrate
   ```

5. Start the API and frontend together:

   ```bash
   npm run dev
   ```

Open `http://localhost:5173`. Accounts are created through the StudyFlow sign-in screen, and authenticated workspace reads are served by `GET /api/workspace`.

For production-style checks, the API can still be started on its own with `npm run server`.

## Current backend boundaries

- Better Auth owns registration, sign-in, sign-out, and sessions under `/api/auth/*`.
- Protected API routes resolve the current user from the session cookie.
- Workspace queries always filter by the authenticated user ID.
- Neon credentials and Better Auth secrets are loaded only from environment variables.

The existing browser-only feature workflows remain available as the frontend migration continues. Their temporary LocalStorage state is namespaced by authenticated user ID to prevent accounts on the same browser from sharing data; it should be replaced with protected API persistence before production launch for cross-device access.
