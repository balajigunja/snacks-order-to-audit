// Who is logged in. Kept in the browser so a refresh does not log you out.
export const getUser = () => {
  try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
};

export function saveSession(token, user) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  // saved offline orders are NOT cleared: they must survive a logout
}

// Which screen each role lands on after login
export const HOME = {
  SALESMAN: '/salesman',
  ADMIN: '/admin',
  PRODUCTION: '/production',
  ACCOUNTANT: '/reports',
  OWNER: '/owner'
};
