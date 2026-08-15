/*
Unisocials — Site Configuration
---------------------------------
These values are used across the site (WhatsApp links, bank details, emails).
When running under the Node server (server.js), this file is served dynamically
and values are pulled from environment variables (set in Render dashboard).

For local development, edit the defaults below directly.
*/

window.SITE_CONFIG = {
  // WhatsApp number shown on the floating chat button (international format, no +)
  WHATSAPP_FLOAT_NUMBER: '2348122104576',

  // WhatsApp number that receives ticket orders & contact form messages
  WHATSAPP_ORDER_NUMBER: '2348122104576',

// Flutterwave public key — used for the inline payment checkout.
  // NOTE: This is served dynamically by server.js from the FLUTTERWAVE_PUBLIC_KEY
  // environment variable for production. The placeholder below is only a local fallback.
  FLUTTERWAVE_PUBLIC_KEY: 'FLWPUBK-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-X',

  // Flutterwave secret key — NEVER exposed to the browser. Used ONLY server-side
  // (server.js) to verify transactions so payments can't be faked/tampered with.
  // Get yours at https://dashboard.flutterwave.com → Settings → API Keys
  // ⚠️ SECURITY: This must NOT contain a real key. It is provided via env vars only.
  FLUTTERWAVE_SECRET_KEY: '',

  // Flutterwave bank account details (Bank Transfer payment)
  FLUTTERWAVE_BANK_NAME: 'Flutterwave MfB (formerly ok mfb)',
  FLUTTERWAVE_ACCOUNT_NUMBER: '9707788756',

  // Contact / support email shown in FAQ
  CONTACT_EMAIL: 'support.sbiamautos@gmail.com',

  // FormSubmit.co email endpoint for the contact form (messages land in the contact inbox)
  FORMSUBMIT_KEY: 'support.sbiamautos@gmail.com',

  // Redirect URL after contact form submission
  REDIRECT_URL: 'https://unisocials.onrender.com/thank-you.html'
};

