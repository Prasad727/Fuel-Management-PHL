import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';

// Each page is downloaded only when it is first opened, so the app starts fast
const Fleet = lazy(() => import('./pages/Fleet.jsx'));
const Fuel = lazy(() => import('./pages/Fuel.jsx'));
const Master = lazy(() => import('./pages/Master.jsx'));
const Staff = lazy(() => import('./pages/Staff.jsx'));
const Procurement = lazy(() => import('./pages/Procurement.jsx'));

export default function App() {
    return (
        <div className="app">
            <Sidebar />
            <main>
                <Suspense fallback={<div className="empty">Loading...</div>}>
                    <Routes>
                        {/* The first page after login: Current Trips. To change it, change "/master" here. */}
                        <Route path="/" element={<Navigate to="/master" replace />} />
                        <Route path="/fleet" element={<Fleet />} />
                        <Route path="/fuel" element={<Fuel />} />
                        <Route path="/master" element={<Master />} />
                        <Route path="/staff" element={<Staff />} />
                        <Route path="/procurement" element={<Procurement />} />
                        <Route path="*" element={<Navigate to="/master" replace />} />
                    </Routes>
                </Suspense>
            </main>
        </div>
    );
}
