// Usage: router.post('/approve', requireLogin, allowRoles('ADMIN'), handler)
export const allowRoles = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Not allowed for your role' });
  }
  next();
};
