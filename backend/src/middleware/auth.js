
import jwt from 'jsonwebtoken';

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-Balaji';

export function requireLogin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please log in' });

  try {
    req.user = jwt.verify(token, JWT_SECRET); // { id, role, name }
    next();
  } catch (err) {
    res.status(401).json({ error: 'Login expired, please log in again' });
  }
}