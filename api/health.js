import '../server/env.js';

export default function health(_request, response) {
  const missing = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL']
    .filter(name => !process.env[name]);

  if (missing.length) {
    response.status(503).json({
      ok: false,
      error: 'Server environment is incomplete.',
      missing
    });
    return;
  }

  response.status(200).json({ ok: true });
}
