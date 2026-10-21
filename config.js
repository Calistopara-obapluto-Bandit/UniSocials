/*
Unisocials — Browser Site Configuration
--------------------------------------
This file is a LOCAL FALLBACK ONLY. It must stay in sync with
BROWSER_CONFIG_KEYS in server.js.

In production server.js intercepts /config.js and generates it from environment
variables, so nothing here reaches a live visitor.

Only values the browser genuinely reads belong in this file. Server-side
settings — API secret keys, the webhook hash, the admin email, the outbound
sender address, bank account details — must never appear here, in any form,
even as an empty placeholder: a value that looks like a secret tends to get
filled in and committed. Keep those in server.js and read them from the
environment there.

To add a value the frontend needs:
  1. add it to BROWSER_CONFIG_KEYS in server.js, and
  2. add it below with a local placeholder,
so the two stay consistent.
*/

window.SITE_CONFIG = {
  // WhatsApp number shown on the floating chat button (international format, no +)
  WHATSAPP_FLOAT_NUMBER: '2348122104576',

  // WhatsApp number that receives ticket order messages
  WHATSAPP_ORDER_NUMBER: '2348122104576',

  // Flutterwave PUBLIC key for the inline checkout. Public by design.
  // The matching secret key lives only in server.js / the environment.
  FLUTTERWAVE_PUBLIC_KEY: 'FLWPUBK-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-X',

  // Contact / support email shown on the FAQ page
  CONTACT_EMAIL: 'support.sbiamautos@gmail.com',

  // FormSubmit.co endpoint for the contact form (messages land in the contact inbox)
  FORMSUBMIT_KEY: 'support.sbiamautos@gmail.com',

  // Redirect URL after payment and after contact form submission
  REDIRECT_URL: 'https://unisocials.onrender.com/thank-you.html'
};
