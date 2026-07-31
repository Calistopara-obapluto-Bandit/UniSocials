/*
UNN Socials — Site Configuration
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

  // Bank transfer payment details
  BANK_NAME: 'GTBank',
  BANK_ACCOUNT_NAME: 'UNN Socials',
  BANK_ACCOUNT_NUMBER: '0123456789',

  // USSD payment code
  USSD_CODE: '*123*456*',

  // Flutterwave public / API key for inline checkout
  FLUTTERWAVE_PUBLIC_KEY: '1d23d4cc-6184-4cf3-9f47-5ad6106b9db9',

  // Flutterwave bank account details
  FLUTTERWAVE_BANK_NAME: 'Flutterwave MfB (formerly ok mfb)',
  FLUTTERWAVE_ACCOUNT_NUMBER: '9707788756',

  // Contact / support email shown in FAQ
  CONTACT_EMAIL: 'support.sbiamautos@gmail.com',

  // FormSubmit.co email endpoint for the contact form (messages land in the contact inbox)
  FORMSUBMIT_KEY: 'support.sbiamautos@gmail.com',

  // Redirect URL after contact form submission
  REDIRECT_URL: 'https://unisocials.onrender.com/thank-you.html'
};

