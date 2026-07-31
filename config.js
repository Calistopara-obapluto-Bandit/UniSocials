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

  // Contact / support email shown in FAQ
  CONTACT_EMAIL: 'support.sbiamautos@gmail.com',

  // FormSubmit.co email key for the contact form
  FORMSUBMIT_KEY: '8d51333da2a9cfabfb087ffb615b7963',

  // Redirect URL after contact form submission
  REDIRECT_URL: 'https://unnsocials.com/thank-you.html'
};

