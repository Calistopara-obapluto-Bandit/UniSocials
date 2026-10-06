// Small helpers shared by the React pages, ported from the equivalent inline
// scripts in the original .html pages so both versions render identical output.

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c];
  });
}

export function fmtN(n) {
  return '₦' + Number(n || 0).toLocaleString();
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString() + ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function orderStatusBadge(status) {
  const badge = status === 'verified' ? 'verified' : (status === 'rejected' ? 'rejected' : 'pending');
  const label = status === 'verified' ? '✅ Verified'
    : (status === 'rejected' ? '❌ Rejected' : '⏳ Pending');
  return <span className={'lookup-badge ' + badge}>{label}</span>;
}

export function ticketStateBadge(tc) {
  const used = !!(tc && tc.used);
  return (
    <span className={'ticket-state ' + (used ? 'used' : 'ok')}>
      {used ? '✓ Used' : '✓ OK'}
    </span>
  );
}

// Ticket links are identical on both the lookup page and the dashboard. A QR
// ticket is a bearer credential, so orderId + code is all it takes to open it.
export function ticketLinks(o) {
  if (o.status === 'verified') {
    const codes = (o.ticketCodes && o.ticketCodes.length)
      ? o.ticketCodes
      : (o.ticketCode ? [{ code: o.ticketCode }] : []);
    if (!codes.length) return null;
    return codes.map((tc, i) => {
      const used = !!(tc && tc.used);
      const href = '/ticket.html?orderId=' + encodeURIComponent(o.orderId) +
        '&code=' + encodeURIComponent(tc.code);
      return (
        <a
          key={tc.code}
          className={'order-code-row' + (used ? ' used' : '')}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'inherit' }}
          href={href}
        >
          <span>Ticket {i + 1}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code>{esc(tc.code)}</code>
            {ticketStateBadge(tc)} →
          </span>
        </a>
      );
    });
  }
  if (o.status === 'pending') {
    return (
      <a
        className="btn-cta-ghost"
        style={{ display: 'inline-flex', padding: '12px 26px' }}
        href={'/pending.html?orderId=' + encodeURIComponent(o.orderId)}
      >
        ⏳ Track Order
      </a>
    );
  }
  return null;
}