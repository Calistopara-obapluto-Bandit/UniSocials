# Unisocials — Secure & Deploy TODO

## Security Hardening (done)
- [x] Remove hardcoded secrets from render.yaml
- [x] Remove hardcoded secrets defaults from server.js
- [x] Create .env.example documenting required env vars
- [x] Add security headers & rate-limiting to server.js
- [x] Obfuscate/minify client JS (templatemo-622-clearwave.min.js)
- [x] Update HTML pages to reference minified JS

## Deployment
- [x] Rebuild minified JS (npm run build)
- [x] Stage & commit all project changes
- [x] Verify GitHub CLI (gh) is installed & authenticated (not needed — used git directly)
- [x] Push to origin/main to trigger Render deploy
- [ ] Confirm Render deploy triggers + set secret env vars in Render dashboard
