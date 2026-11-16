import { app } from '../server/index.js';

export default function apiHandler(req, res) {
  // If Vercel rewrote the path into req.query or stripped the /api prefix:
  if (!req.url || req.url === '/' || req.url.startsWith('/?')) {
    const rawPath = req.query?.match || req.query?.path || '';
    const pathStr = Array.isArray(rawPath) ? rawPath.join('/') : String(rawPath);
    if (pathStr) {
      const queryString = req.url && req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
      req.url = '/api/' + pathStr.replace(/^\/+/, '') + queryString;
    }
  } else if (!req.url.startsWith('/api') && !req.url.startsWith('/')) {
    req.url = '/' + req.url;
  }
  return app(req, res);
}
