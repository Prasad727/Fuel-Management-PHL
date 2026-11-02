import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';

// Each page is downloaded only when it is first opened, so the app starts fast
const Fleet = lazy(() => import('./pages/Fleet.jsx'));
const Fuel = lazy(() => import('./pages/Fuel.jsx'));
const Master = lazy(() => import('./pages/Master.jsx'));
const Staff = lazy(() => import('./pages/Staff.jsx'));

export default function App() {
  return (
    <div className="app">
      <Sidebar />
      <main>
        <Suspense fallback={<div className="empty">Loading...</div>}>
          <Routes>
            <Route path="/" element={<Fleet />} />
            <Route path="/fleet" element={<Fleet />} />
            <Route path="/fuel" element={<Fuel />} />
            <Route path="/master" element={<Master />} />
            <Route path="/staff" element={<Staff />} />
            <Route path="*" element={<Navigate to="/fleet" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
