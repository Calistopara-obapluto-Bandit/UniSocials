import { Routes, Route, Navigate } from 'react-router-dom';
import Lookup from './pages/Lookup.jsx';
import MyTickets from './pages/MyTickets.jsx';
import Checkout from './pages/Checkout.jsx';
import ThankYou from './pages/ThankYou.jsx';
import Events from './pages/Events.jsx';
import Tickets from './pages/Tickets.jsx';
import Pending from './pages/Pending.jsx';
import Ticket from './pages/Ticket.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Home from './pages/Home.jsx';
import About from './pages/About.jsx';
import Faq from './pages/Faq.jsx';
import Contact from './pages/Contact.jsx';
import Admin from './pages/Admin.jsx';

// Phase 1 and Phase 2 ship the account-free flow (lookup, my-tickets) and the
// checkout/thank-you flow. Phase 5 ports additional page by page. server.js is
// the one that decides which version of each URL is canonical: the React build
// when it exists, otherwise the legacy .html page. The React routes here are
// only used for client-side links inside the built app and for server.js's SPA
// entry serving.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/index.html" element={<Home />} />
      <Route path="/lookup" element={<Lookup />} />
      <Route path="/my-tickets" element={<MyTickets />} />
      <Route path="/checkout" element={<Checkout />} />
      <Route path="/checkout.html" element={<Checkout />} />
      <Route path="/thank-you" element={<ThankYou />} />
      <Route path="/thank-you.html" element={<ThankYou />} />
      <Route path="/events" element={<Events />} />
      <Route path="/events.html" element={<Events />} />
      <Route path="/tickets" element={<Tickets />} />
      <Route path="/tickets.html" element={<Tickets />} />
      <Route path="/pending" element={<Pending />} />
      <Route path="/pending.html" element={<Pending />} />
      <Route path="/ticket" element={<Ticket />} />
      <Route path="/ticket.html" element={<Ticket />} />
      <Route path="/login" element={<Login />} />
      <Route path="/login.html" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/register.html" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/forgot-password.html" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/reset-password.html" element={<ResetPassword />} />
      <Route path="/about" element={<About />} />
      <Route path="/about.html" element={<About />} />
      <Route path="/faq" element={<Faq />} />
      <Route path="/faq.html" element={<Faq />} />
      <Route path="/contact" element={<Contact />} />
      <Route path="/contact.html" element={<Contact />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/admin.html" element={<Admin />} />
      <Route path="*" element={<Navigate to="/lookup" replace />} />
    </Routes>
  );
}