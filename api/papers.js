import { app } from '../server/index.js';

export default function handler(req, res) {
  if (!req.url || req.url === '/' || req.url.startsWith('/?')) {
    req.url = '/api/papers' + (req.url && req.url.startsWith('/?') ? req.url : '');
  } else if (!req.url.startsWith('/api/papers') && !req.url.startsWith('/papers')) {
    req.url = '/api/papers' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  return app(req, res);
}
