import { useNavigate } from 'react-router-dom';
import { getUser, clearSession } from '../auth.js';

const ROLE_NAME = {
  SALESMAN: 'Salesman', ADMIN: 'Factory admin', PRODUCTION: 'Production',
  ACCOUNTANT: 'Accountant', OWNER: 'Owner'
};

// The white top bar + page container shared by every screen.
export default function Layout({ wide, children }) {
  const user = getUser();
  const navigate = useNavigate();

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
      <div className={wide ? 'page wide' : 'page'}>{children}</div>
    </div>
  );
}
