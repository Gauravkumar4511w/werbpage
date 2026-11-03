/* global process */
// Import first in every test file. server.js loads .env, which may hold real SMS and email keys;
// variables already set are not overwritten, so blanking them keeps tests from sending real codes.
for (const key of [
  'MSG91_AUTH_KEY', 'MSG91_TEMPLATE_ID', 'FAST2SMS_API_KEY',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'TWILIO_MESSAGING_SERVICE_SID',
  'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'SMTP_HOST', 'SMTP_PORT',
  'RESEND_API_KEY', 'OTP_EMAIL_FROM', 'OTP_DEV_MODE', 'OTP_SECRET', 'GOOGLE_CLIENT_ID',
]) process.env[key] = ''
