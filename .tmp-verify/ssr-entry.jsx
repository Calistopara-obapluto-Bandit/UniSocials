// SSR entry used to prove every React admin component actually renders.
// renderToString exercises each component's render path without a browser;
// a crash anywhere (bad JSX, undefined context value, etc.) throws here.
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { AdminCtx } from '../app/pages/admin/adminContext.js';
import Admin from '../app/pages/Admin.jsx';
import OverviewPanel from '../app/pages/admin/OverviewPanel.jsx';
import CheckinPanel from '../app/pages/admin/CheckinPanel.jsx';
import EventsPanel from '../app/pages/admin/EventsPanel.jsx';
import UniversitiesPanel from '../app/pages/admin/UniversitiesPanel.jsx';
import SubscribersPanel from '../app/pages/admin/SubscribersPanel.jsx';
import SubAdminsPanel from '../app/pages/admin/SubAdminsPanel.jsx';
import InfluencersPanel from '../app/pages/admin/InfluencersPanel.jsx';
import EventAuthorizationsPanel from '../app/pages/admin/EventAuthorizationsPanel.jsx';
import StaffPanel from '../app/pages/admin/StaffPanel.jsx';
import CustomersPanel from '../app/pages/admin/CustomersPanel.jsx';
import PayoutsPanel from '../app/pages/admin/PayoutsPanel.jsx';
import CouponsPanel from '../app/pages/admin/CouponsPanel.jsx';
import WorkersPanel from '../app/pages/admin/WorkersPanel.jsx';
import UniversitySubAdminsPanel from '../app/pages/admin/UniversitySubAdminsPanel.jsx';
import Events from '../app/pages/Events.jsx';

const noop = () => {};

// Shared context with dummy handlers: render-time code may call them, but no
// effect runs during SSR, so no network traffic happens.
const ctx = {
  showToast: noop,
  loadOrders: noop,
  loadUniversities: noop,
  loadEvents: noop,
  switchTab: noop,
  universities: [
    { id: 'u1', name: 'University of Nigeria', location: 'Nsukka', state: 'Enugu', categories: ['Medicine', 'Law'] }
  ],
  events: [
    {
      id: 'e1', name: 'Dinner Night', category: 'General', price: 3000, bonusPrice: 2600,
      vipPrice: 5000, date: 'May 20, 2025', universityId: 'u1', universityName: 'University of Nigeria',
      commissionPlan: 'reduced_15', authorizedInfluencerAdminIds: ['staff-1']
    },
    {
      id: 'e2', name: 'Standard Fest', category: 'General', price: 2000, date: 'Jun 1, 2025',
      universityId: 'u1', universityName: 'University of Nigeria', commissionPlan: 'standard',
      authorizedInfluencerAdminIds: []
    }
  ],
  activeTab: 'overview'
};

const orders = [{
  orderId: 'UNI-TEST-0001', status: 'pending', amount: 3000, qty: 1,
  eventName: 'Dinner Night', eventDate: 'May 20, 2025', eventVenue: 'Nsukka Hall',
  eventCategory: 'General', buyerName: 'Test Buyer', buyerEmail: 't@example.com',
  createdAt: new Date().toISOString()
}];

export function renderAdminShell() {
  return renderToString(createElement(Admin));
}

export function renderPanels() {
  const wrap = (el) => renderToString(createElement(AdminCtx.Provider, { value: ctx }, el));
  // Every panel is rendered as the ACTIVE tab here: admin.css hides
  // `.admin-panel` unless it carries `.active`, so a panel that never emits
  // that class would be permanently invisible in the dashboard.
  const on = { active: true };
  const out = {};
  out.overview = wrap(createElement(OverviewPanel, { orders, lastUpdated: '12:00:00', ...on }));
  out.checkin = wrap(createElement(CheckinPanel, on));
  out.events = wrap(createElement(EventsPanel, on));
  out.universities = wrap(createElement(UniversitiesPanel, on));
  out.subscribers = wrap(createElement(SubscribersPanel, on));
  out.subadmins = wrap(createElement(SubAdminsPanel, on));
  out.influencers = wrap(createElement(InfluencersPanel, on));
  out.eventAuth = wrap(createElement(EventAuthorizationsPanel, on));
  out.staff = wrap(createElement(StaffPanel, on));
  out.customers = wrap(createElement(CustomersPanel, on));
  out.payouts = wrap(createElement(PayoutsPanel, on));
  out.coupons = wrap(createElement(CouponsPanel, on));
  out.workers = wrap(createElement(WorkersPanel, on));
  out.universitySubadmins = wrap(createElement(UniversitySubAdminsPanel, on));
  return out;
}

export function renderEventsPage() {
  return renderToString(createElement(Events));
}
