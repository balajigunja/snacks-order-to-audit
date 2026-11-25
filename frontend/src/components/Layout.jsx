import { NavLink, useNavigate } from 'react-router-dom';
import { getUser, clearSession } from '../auth.js';

const ROLE_NAME = {
  SALESMAN: 'Salesman', ADMIN: 'Factory admin', PRODUCTION: 'Production',
  ACCOUNTANT: 'Accountant', OWNER: 'Owner'
};

// The menu each role sees. (The server still checks the role on every request.)
const MENU = {
  SALESMAN: [],
  ADMIN: [['/admin', 'Orders and billing'], ['/production', 'Production'], ['/reports', 'Reports']],
  PRODUCTION: [['/production', 'Production'], ['/reports', 'Reports']],
  ACCOUNTANT: [['/reports', 'Reports']],
  OWNER: [['/owner', 'Dashboard'], ['/reports', 'Reports']]
};

// The white top bar + menu + page container shared by every screen.
export default function Layout({ wide, children }) {
  const user = getUser();
  const navigate = useNavigate();
  const links = MENU[user.role];

  function signOut() {
    clearSession();
    navigate('/');
  }

  return (
    <div>
      <div className="topbar">
        <div className="brand"><b>Snack</b> Factory</div>
        <div className="who">
          <span>{user.name} <span className="chip blue">{ROLE_NAME[user.role]}</span></span>
          <button className="btn btn-small" onClick={signOut}>Sign out</button>
        </div>
      </div>
      {links.length > 0 && (
        <div className="nav">
          {links.map(([path, label]) => <NavLink key={path} to={path}>{label}</NavLink>)}
        </div>
      )}
      <div className={wide ? 'page wide' : 'page'}>{children}</div>
    </div>
  );
}
