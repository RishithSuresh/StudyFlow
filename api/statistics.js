import { app } from '../server/index.js';

export default function handler(req, res) {
  if (!req.url || req.url === '/' || req.url.startsWith('/?')) {
    req.url = '/api/statistics' + (req.url && req.url.startsWith('/?') ? req.url : '');
  }
  return app(req, res);
}
