# Convert UNN Socials to Render Web Service with Centralized Config

## Phase 1: Web Service Files
- [x] 1. Create `package.json` (Node app with `npm start` script)
- [x] 2. Create `server.js` (zero-dependency static file server + dynamic config.js from env vars)
- [x] 3. Create `config.js` (static fallback defaults for local dev)

## Phase 2: Render Blueprint
- [x] 4. Update `render.yaml` to web service (runtime: node, build: npm install, start: npm start) + env vars

## Phase 3: HTML Files
- [x] 5. Load `config.js` in all pages (index, events, tickets, about, faq, contact)
- [x] 6. Add IDs for dynamic values (contact phone, FAQ email, form action, redirect URL)

## Phase 4: JavaScript
- [x] 7. Add SITE_CONFIG application section in `templatemo-622-clearwave.js`
- [x] 8. Update `placeOrder()` and contact form handler to use config values
- [x] 9. Update `updatePaymentNote()` to use config bank/USSD values

## Phase 5: Test & Deploy
- [x] 10. Test server locally (`npm start`)
- [x] 11. Commit and push to GitHub
- [x] 12. Verify Render blueprint picks up web service

## Phase 6: WhatsApp Number Update & Deploy
- [x] 13. Update `WHATSAPP_ORDER_NUMBER` from `2348123456789` to `2348122104576` in `config.js`, `server.js`, `render.yaml`, `templatemo-622-clearwave.js`
- [x] 14. Test server locally (verified config.js serves new number)
- [x] 15. Commit & push to GitHub (commit `0423527`)
- [x] 16. Verify live deployment on Render (https://unisocials.onrender.com) serves `WHATSAPP_ORDER_NUMBER: 2348122104576`

