import { Routes, Route, Navigate } from 'react-router-dom';
import { getUser, HOME } from './auth.js';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import SalesmanOrders from './pages/SalesmanOrders.jsx';
import AdminOrders from './pages/AdminOrders.jsx';
import ProductionPage from './pages/ProductionPage.jsx';
import Reports from './pages/Reports.jsx';
import OwnerDashboard from './pages/OwnerDashboard.jsx';

// A page that only the listed roles may open. Not logged in -> login page. Wrong role -> their own home page.
// (The server checks the role too: this only decides what the person SEES.)
function Protected({ roles, children }) {
  const user = getUser();
  if (!user) return <Navigate to="/" replace />;
  if (!roles.includes(user.role)) return <Navigate to={HOME[user.role]} replace />;
  return <Layout wide={user.role !== 'SALESMAN'}>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/salesman" element={<Protected roles={['SALESMAN']}><SalesmanOrders /></Protected>} />
      <Route path="/admin" element={<Protected roles={['ADMIN']}><AdminOrders /></Protected>} />
      <Route path="/production" element={<Protected roles={['PRODUCTION', 'ADMIN']}><ProductionPage /></Protected>} />
      <Route path="/reports" element={<Protected roles={['ACCOUNTANT', 'ADMIN', 'OWNER']}><Reports /></Protected>} />
      <Route path="/owner" element={<Protected roles={['OWNER']}><OwnerDashboard /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
