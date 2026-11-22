// TODO: verify JWT from "Authorization: Bearer <token>" and set req.user = { id, role }
export function requireLogin(req, res, next) {
  next();
}
