import { Routes, Route } from 'react-router-dom';
import Login from './pages/Login.jsx';
import SalesmanOrders from './pages/SalesmanOrders.jsx';
import AdminOrders from './pages/AdminOrders.jsx';
import ProductionPage from './pages/ProductionPage.jsx';
import Reports from './pages/Reports.jsx';
import OwnerDashboard from './pages/OwnerDashboard.jsx';

// TODO: after login, redirect by role and block pages of other roles
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/salesman" element={<SalesmanOrders />} />
      <Route path="/admin" element={<AdminOrders />} />
      <Route path="/production" element={<ProductionPage />} />
      <Route path="/reports" element={<Reports />} />
      <Route path="/owner" element={<OwnerDashboard />} />
    </Routes>
  );
}
