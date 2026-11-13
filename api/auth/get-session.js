import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../../server/auth.js';

export default async function getSession(req, res) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers)
    });
    res.status(200).json(session);
  } catch (error) {
    console.error('Unable to load the current session.', error);
    res.status(500).json({ error: 'Unable to load the current session.' });
  }
}
