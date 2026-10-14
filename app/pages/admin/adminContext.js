import { createContext, useContext } from 'react';

// Shared values the admin panels need without prop-drilling through the shell:
// a toast notifier, the orders reload used after check-ins/status changes, the
// tab switcher, and the university catalogue shared by the event form, the
// universities manager and the subscriber filter.
export const AdminCtx = createContext(null);

export function useAdmin() {
  return useContext(AdminCtx);
}
