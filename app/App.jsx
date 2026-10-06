import { Routes, Route, Navigate } from 'react-router-dom';
import Lookup from './pages/Lookup.jsx';
import MyTickets from './pages/MyTickets.jsx';
import Checkout from './pages/Checkout.jsx';
import ThankYou from './pages/ThankYou.jsx';
import Events from './pages/Events.jsx';

// Phase 1 and Phase 2 ship the account-free flow (lookup, my-tickets) and the
// checkout/thank-you flow. Phase 5 ports additional page by page. server.js is
// the one that decides which version of each URL is canonical: the React build
// when it exists, otherwise the legacy .html page. The React routes here are
// only used for client-side links inside the built app and for server.js's SPA
// entry serving.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/lookup" replace />} />
      <Route path="/lookup" element={<Lookup />} />
      <Route path="/my-tickets" element={<MyTickets />} />
      <Route path="/checkout" element={<Checkout />} />
      <Route path="/thank-you" element={<ThankYou />} />
      <Route path="/events" element={<Events />} />
      <Route path="*" element={<Navigate to="/lookup" replace />} />
    </Routes>
  );
}