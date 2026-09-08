# 🎉 Subadmin Referral Link Tracking System - Deployment Summary

## Status: ✅ DEPLOYED TO GITHUB

**Branch**: `feature/subadmin-referral-tracking`  
**PR**: https://github.com/Calistopara-obapluto-Bandit/UniSocials/pull/new/feature/subadmin-referral-tracking  
**Commit**: `27c8fd0` feat: Add subadmin referral link tracking system

---

## 📦 What Was Implemented

### 1. Backend API Enhancements (server.js)

#### New Storage Functions
```javascript
- readReferralLinks() - Read all referral links
- writeReferralLinks() - Write referral links to storage  
- getReferralLinkByCode() - Lookup by code
- getReferralLinkBySubadminId() - Get subadmin's link
- generateReferralLink() - Create unique link for subadmin
- updateReferralStats() - Update order/revenue stats
```

#### New Database Table
```sql
CREATE TABLE referral_links (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
)
```

#### New API Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/subadmin/referral-link` | GET | Get/generate subadmin's referral link |
| `/api/subadmin/referral-stats` | GET | Get referral sales statistics |

#### Order Tracking
- Added `referralCode` field to orders
- Auto-captures `?ref=CODE` URL parameter
- Updates referral stats when order is verified

---

### 2. Subadmin Dashboard UI (subadmin.html)

#### New "📈 Referral Links" Tab
- **Stats Display Cards**:
  - 🎯 Events Sold (total orders via referral)
  - 🎫 Tickets Sold (total quantity)
  - 💰 Total Revenue (₦)

- **Share Features**:
  - Referral code display + copy button
  - Full URL display + copy button
  - Instructions panel

#### JavaScript Functions Added
```javascript
- loadReferralLink() - Fetch and display referral link
- loadReferralStats() - Update stats from server
- copyReferralCode() - Copy to clipboard
- copyReferralLink() - Copy full URL to clipboard
```

---

### 3. Checkout Integration (templatemo-622-clearwave.js)

#### URL Parameter Capture
```javascript
// Automatically extracts ?ref=CODE from URL
const urlParams = new URLSearchParams(window.location.search);
const referralCode = urlParams.get('ref') || '';
```

#### Order Attribution
- Referral code automatically included in order creation
- Works seamlessly with existing checkout flow
- No changes needed in buyer experience

---

## 🚀 How It Works

### Step 1: Subadmin Generates Link
```
Login → Dashboard → "📈 Referral Links" Tab
↓
System auto-generates: REF-ABC123DE
Full URL: https://your-site.com/?ref=REF-ABC123DE
```

### Step 2: Share the Link
```
Copy Referral Code → Share via WhatsApp/Telegram/Social Media
OR
Copy Full URL → Send directly
```

### Step 3: Track Sales
```
Someone clicks link + buys ticket
↓
Order tagged with referral code
↓
Dashboard updates with real-time stats
```

---

## 📊 Data Structure

### Referral Link Object
```javascript
{
  code: "REF-ABC123DE",           // Unique referral code
  subadminId: "SUB-XXXX",         // Subadmin's user ID
  subadminName: "John Doe",       // Subadmin's display name
  subadminEmail: "john@email.com",// Subadmin's email
  createdAt: "2025-08-13T12:34:56Z", // When link was generated
  totalOrders: 15,                // Orders from this referral
  totalRevenue: 75000             // Total revenue (₦)
}
```

### Order with Referral
```javascript
{
  orderId: "UNI-XXXX-XXXX",
  referralCode: "REF-ABC123DE",   // NEW: Attribution field
  status: "verified",
  amount: 5000,
  qty: 2,
  // ... other order fields
}
```

---

## 🔧 Configuration

### PostgreSQL (Production)
Database URL: Set via `DATABASE_URL` environment variable
```
DATABASE_URL=postgresql://user:pass@host/db
```

### JSON Files (Development/Fallback)
Auto-created: `data/referral_links.json`

---

## 📋 Testing Checklist

- [ ] Clone the feature branch
  ```bash
  git checkout feature/subadmin-referral-tracking
  ```

- [ ] Start the server
  ```bash
  npm install
  node server.js
  ```

- [ ] Log into subadmin dashboard at http://localhost:3000/subadmin.html

- [ ] Verify "📈 Referral Links" tab is present

- [ ] Check referral code is generated
  ```bash
  cat data/referral_links.json
  ```

- [ ] Buy a ticket using referral link
  ```
  http://localhost:3000/events.html?ref=REF-ABC123DE
  ```

- [ ] Verify order has `referralCode` field
  ```bash
  cat data/orders.json | grep referralCode
  ```

- [ ] Check dashboard stats update after payment

---

## 🔄 Merge Instructions

### Option 1: Merge via GitHub UI
1. Visit PR: https://github.com/Calistopara-obapluto-Bandit/UniSocials/pulls
2. Click "Merge pull request"
3. Confirm merge

### Option 2: Merge via Command Line
```bash
git checkout main
git pull origin main
git merge feature/subadmin-referral-tracking
git push origin main
```

### Option 3: Squash & Merge
```bash
git checkout main
git merge --squash feature/subadmin-referral-tracking
git commit -m "feat: Add subadmin referral link tracking system"
git push origin main
```

---

## 📝 Files Modified

| File | Changes | Lines |
|------|---------|-------|
| `server.js` | Backend API, storage, referral functions | +85 |
| `subadmin.html` | Dashboard tab, UI, JavaScript | +180 |
| `templatemo-622-clearwave.js` | URL parameter capture | +8 |

**Total Changes**: 3 files, ~273 insertions, 35 deletions

---

## 🎯 Key Features

✅ **Automatic Code Generation** - Unique code per subadmin, regenerated once  
✅ **Real-time Tracking** - Stats update after payment verification  
✅ **One-Click Sharing** - Copy code or full URL with single button  
✅ **Beautiful Dashboard** - Clean stats display with visual cards  
✅ **Error Handling** - Console logs and user-friendly error messages  
✅ **Dual Storage** - PostgreSQL + JSON file support  
✅ **Backwards Compatible** - Existing orders and events unaffected  
✅ **Multi-tenant Ready** - Works with any university/multi-tenant setup  

---

## 🐛 Debugging

### Check Referral Link Creation
```bash
# View referral links file
cat data/referral_links.json

# Search server logs for
# "✓ Event created:" or "✗ Error creating event:"
```

### Monitor Order Attribution
```bash
# Check if orders have referralCode field
grep referralCode data/orders.json
```

### Browser Console Errors
```javascript
// Check for errors in browser DevTools (F12)
// Look for messages from loadReferralLink() and loadReferralStats()
```

---

## 📞 Support

For issues or questions:
1. Check browser console (F12 → Console)
2. Check server terminal for log messages
3. Verify files are being saved to `data/` directory
4. Ensure PostgreSQL DATABASE_URL is set for production

---

## 📅 Timeline

- **2025-08-13**: Feature implemented and pushed to GitHub
- **Commit**: 27c8fd0
- **Branch**: feature/subadmin-referral-tracking
- **Status**: Ready for review and merge

---

**Deployed by**: GitHub Copilot Agent  
**Date**: August 13, 2025  
**Repository**: https://github.com/Calistopara-obapluto-Bandit/UniSocials

## Canonical referral URL

All influencer and sub-admin referral links must use:

`https://unisocials.onrender.com/events.html?ref=REF-XXXXXXXX`

The server now permanently redirects legacy `/referral-events.html?ref=...` requests to the canonical Events URL and the referral-link APIs expose a canonical `referralUrl`. This also protects existing accounts whose old links were generated before the migration.
