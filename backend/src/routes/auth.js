import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db/connection.js';
import { requireLogin, JWT_SECRET } from '../middleware/auth.js';

const router = Router();


router.post('/login', (req, res) => {
  const email = String((req.body && req.body.email) || '');
  const password = String((req.body && req.body.password) || '');

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }

  
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});


router.get('/me', requireLogin, (req, res) => res.json(req.user));

export default router;