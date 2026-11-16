import { toNodeHandler } from 'better-auth/node';
import { auth } from '../../server/auth.js';

const handler = toNodeHandler(auth);

export default function authHandler(req, res) {
  if (req.url && !req.url.startsWith('/api/auth')) {
    const rawMatch = req.query?.match || req.query?.all || '';
    const matchStr = Array.isArray(rawMatch) ? rawMatch.join('/') : String(rawMatch);
    if (matchStr) {
      const qs = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
      req.url = '/api/auth/' + matchStr.replace(/^\/+/, '') + qs;
    } else if (req.url.startsWith('/auth')) {
      req.url = '/api' + req.url;
    } else {
      req.url = '/api/auth' + (req.url.startsWith('/') ? req.url : '/' + req.url);
    }
  }
  return handler(req, res);
}
