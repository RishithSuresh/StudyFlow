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

Open `http://localhost:5173`. Accounts are created through the StudyFlow sign-in screen. Authenticated workspace state, including mock paper metadata and imported mistakes, is loaded and saved through `/api/workspace`; paper binaries remain in the browser's IndexedDB.

For production-style checks, the API can still be started on its own with `npm run server`.

## Current backend boundaries

- Better Auth owns registration, sign-in, sign-out, and sessions under `/api/auth/*`.
- Protected API routes resolve the current user from the session cookie.
- Workspace queries always filter by the authenticated user ID.
- Neon credentials and Better Auth secrets are loaded only from environment variables.

LocalStorage remains a short-term cache, namespaced by authenticated user ID. The protected workspace API is the source of truth for the review workspace and uses the existing `user_settings.settings` JSONB column, so no additional migration is required after `npm run db:migrate`.
