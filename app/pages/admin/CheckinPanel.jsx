import { useEffect, useRef, useState } from 'react';
import { useAdmin } from './adminContext.js';
import { adminFetch } from './adminApi.js';
import { fmtN, fmtDate, esc } from '../../lib/utils.jsx';

// Load the repo's jsQR bundle once, on demand, when the camera scanner opens.
// Keeping it out of the main bundle matches the legacy page, which loaded it
// with a plain <script> tag.
let jsqrPromise = null;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(true);
  if (jsqrPromise) return jsqrPromise;
  jsqrPromise = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = '/jsqr.min.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return jsqrPromise;
}

// Gate Check-in panel: manual Order ID + Ticket Code entry, plus a camera QR
// scanner that decodes the ticket QR and auto-submits the check-in.
export default function CheckinPanel({ active }) {
  const { showToast, loadOrders } = useAdmin();
  const [orderId, setOrderId] = useState('');
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null); // { cls, html }
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraMsg, setCameraMsg] = useState('Point camera at the ticket QR code');

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const overlayRef = useRef(null);

  // Tear the camera down when the tab is left or the component unmounts.
  useEffect(() => () => stopScanner(), []);
  useEffect(() => {
    if (!active) stopScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function stopScanner() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
    setCameraMsg('Point camera at the ticket QR code');
  }

  async function toggleScanner() {
    if (cameraOn) { stopScanner(); return; }
    const ok = await loadJsQR();
    if (!ok) { setCameraMsg('⚠️ QR scanner library not loaded.'); return; }
    startScanner();
  }

  function startScanner() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: 640, height: 480 } })
      .then((stream) => {
        streamRef.current = stream;
        video.srcObject = stream;
        video.play();
        const ctx = canvas.getContext('2d');
        setCameraOn(true);

        function decodeFrame() {
          if (!streamRef.current || video.readyState < 2) {
            rafRef.current = requestAnimationFrame(decodeFrame);
            return;
          }
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 480;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const found = window.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
          if (found && found.data) {
            const decoded = found.data;
            if (overlayRef.current) overlayRef.current.textContent = '✅ QR found! Processing...';
            // Expected format: "ORDERID:TKT-CODE" or "https://...?orderId=...&code=..."
            let oid = '', tcode = '';
            if (decoded.indexOf('orderId=') !== -1) {
              try {
                const u = new URL(decoded);
                oid = u.searchParams.get('orderId') || '';
                tcode = u.searchParams.get('code') || '';
              } catch (e) {}
            } else if (decoded.indexOf(':') !== -1) {
              const parts = decoded.split(':');
              oid = parts[0] || '';
              tcode = parts.slice(1).join(':') || '';
            } else {
              tcode = decoded;
            }
            if (oid) setOrderId(oid);
            if (tcode) setCode(tcode);
            stopScanner();
            // Auto-scan after a brief pause, once the inputs have settled.
            setTimeout(() => submitScan(oid || '', tcode || ''), 300);
          } else {
            if (overlayRef.current) overlayRef.current.textContent = '🔍 Point camera at the ticket QR code';
            rafRef.current = requestAnimationFrame(decodeFrame);
          }
        }
        decodeFrame();
      })
      .catch(() => {
        setCameraMsg('⚠️ Camera access denied or not available.');
      });
  }

  function renderScanResult(cls, rowsHtml) {
    setResult({ cls, html: rowsHtml });
  }

  async function submitScan(oidArg, codeArg) {
    const oid = (oidArg != null ? oidArg : orderId).trim();
    const cd = (codeArg != null ? codeArg : code).trim();
    if (!oid || !cd) {
      renderScanResult('warn', '⚠️ Enter both the Order ID and the Ticket Code.');
      return;
    }
    try {
      const data = await adminFetch('/api/ticket/scan', {
        method: 'POST',
        body: JSON.stringify({ orderId: oid, code: cd })
      });
      if (data && data.success) {
        const t = data.ticket || {};
        const cls = data.alreadyUsed ? 'warn' : 'success';
        const status = data.alreadyUsed ? '♻️ Already checked in' : '✅ Check-in successful!';
        const rows = [];
        const row = (label, val) => {
          if (val === null || val === undefined || val === '') return;
          rows.push(
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '2px 0' }}>
              <span style={{ opacity: 0.75 }}>{label}</span><strong>{val}</strong>
            </div>
          );
        };
        row('🎤 Event', esc(t.eventName || data.eventName || '—'));
        if (t.ticketIndex) row('🎟 Ticket', '#' + esc(String(t.ticketIndex)) + ' of ' + esc(String(t.totalTickets || t.qty)));
        if (t.ticketTier) row('🪑 Tier', esc(String(t.ticketTier).replace(/^./, (c) => c.toUpperCase())));
        if (t.qty) row('📦 Qty', esc(String(t.qty)));
        row('📅 Date', esc(t.eventDate || '—'));
        row('📍 Venue', esc(t.eventVenue || '—'));
        row('🏛 University', esc(t.universityName || '—'));
        row('👤 Buyer', esc(t.buyerName || '—'));
        row('📧 Email', esc(t.buyerEmail || '—'));
        row('📞 Phone', esc(t.buyerPhone || '—'));
        if (t.amount) row('💰 Amount', esc(fmtN(t.amount)));
        row('🧾 Order', esc(t.orderId || data.orderId || '—'));
        row('🔑 Code', esc(cd));
        if (t.verifiedAt) row('✅ Verified', esc(fmtDate(t.verifiedAt)));
        if (t.usedAt) row('♻️ Used at', esc(fmtDate(t.usedAt)));
        if (t.checkedInBy) row('👮 By', esc(String(t.checkedInBy)));
        renderScanResult(cls, (
          <>
            <div style={{ marginBottom: 8 }}>
              <strong>{status}</strong> <span style={{ opacity: 0.8 }}>{esc(data.message || '')}</span>
            </div>
            <div style={{ borderTop: '1px dashed rgba(0,0,0,0.2)', margin: '8px 0', paddingTop: 8 }}>
              {rows}
            </div>
          </>
        ));
        showToast(data.alreadyUsed ? 'Ticket was already used' : 'Ticket checked in ✅', data.alreadyUsed);
        loadOrders();
        setOrderId('');
        setCode('');
      } else {
        const err = (data && data.error) || 'Ticket could not be verified';
        renderScanResult('error', <>❌ {esc(err)}</>);
        showToast('Check-in failed', true);
      }
    } catch (e) {
      renderScanResult('error', <>❌ Network error checking in ticket.</>);
      showToast('Network error checking in', true);
    }
  }

  return (
    <div className="admin-panel" id="panel-checkin">
      <div className="admin-panel-heading">
        <div>
          <h1>🎫 Gate Check-in / Scan Ticket</h1>
          <p>
            Enter the Order ID and ticket code, or tap <strong>📷 Scan QR</strong> to scan the buyer&apos;s ticket QR
            code with your camera. The ticket will be marked as used and cannot be reused.
          </p>
        </div>
      </div>
      <div className="admin-scan-panel">
        <div className="admin-scan-inputs">
          <div className="form-group">
            <label htmlFor="scanOrderId">Order ID</label>
            <input type="text" id="scanOrderId" placeholder="UNI-XXXX-XXXX" autoComplete="off"
              value={orderId} onChange={(e) => setOrderId(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="scanCode">Ticket Code</label>
            <input type="text" id="scanCode" placeholder="TKT-XXXXXX" autoComplete="off"
              value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <button className="btn-submit" style={{ whiteSpace: 'nowrap' }} onClick={() => submitScan()}>✅ Check In</button>
          <button className="admin-filter-btn" id="qrScanBtn" onClick={toggleScanner}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {cameraOn ? '✕ Stop Camera' : '📷 Scan QR'}
          </button>
        </div>
        <div className="admin-scan-camera" id="scanCameraWrap" style={{ display: cameraOn ? 'block' : 'none' }}>
          <div className="admin-scan-camera-inner">
            <video ref={videoRef} autoPlay playsInline muted></video>
            <canvas ref={canvasRef} style={{ display: 'none' }}></canvas>
            <div className="admin-scan-camera-overlay" ref={overlayRef}>{cameraMsg}</div>
          </div>
          <button className="action-btn action-reject" style={{ marginTop: 8 }} onClick={stopScanner}>✕ Stop Camera</button>
        </div>
        <div className={'admin-scan-result' + (result ? ' show' : '')}>
          {result ? <div className={'scan-result-box ' + result.cls}>{result.html}</div> : null}
        </div>
      </div>
    </div>
  );
}
