import { Routes, Route, Navigate } from 'react-router-dom';
import Lookup from './pages/Lookup.jsx';
import MyTickets from './pages/MyTickets.jsx';

// Phase 1 of the migration ships two routes. Everything else is still served as
// the original server-rendered .html file by server.js, so no existing URL or
// link breaks while the remaining pages are ported.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/lookup" replace />} />
      <Route path="/lookup" element={<Lookup />} />
      <Route path="/my-tickets" element={<MyTickets />} />
      <Route path="*" element={<Navigate to="/lookup" replace />} />
    </Routes>
  );
}