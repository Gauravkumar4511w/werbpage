# React + Vite

## Razorpay UPI coin purchases

The buy-coins flow uses Razorpay Checkout, where users can select UPI. Add these values to `.env` locally and to the Vercel project environment variables:

```env
VITE_RAZORPAY_KEY_ID=rzp_live_your_public_key
RAZORPAY_KEY_ID=rzp_live_your_public_key
RAZORPAY_KEY_SECRET=your_server_secret
```

`RAZORPAY_KEY_SECRET` must remain server-side. Orders are created by `/api/payments/razorpay/order`, and `/api/payments/razorpay/verify` checks the Razorpay signature and captured payment before the client adds coins.

Copy `.env.example` to `.env` and add your Razorpay credentials. Keep `RAZORPAY_KEY_SECRET` server-side.

Run the payment API and frontend separately:

```powershell
npm run api
npm run dev
```

The buy flow creates a Razorpay order and verifies the captured payment signature before adding coins. A persistent server-side wallet ledger is still recommended for production crediting.


This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.
You can also try [the experimental native React Compiler support in plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md#rust-react-compiler) by using `compiler: true` in the plugin options instead of using the Babel plugin.

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
# werbpage

## Admin login

Run `npm run dev` from this directory and open `http://localhost:5173/#admin`. The development server also serves `/api`; `npm run api` is optional when using Vite. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in your local `.env` and in the hosting environment.

Admin sessions use signed tokens when `ADMIN_PASSWORD` is configured, so separate API instances can verify the same login. You can set a private `ADMIN_SESSION_SECRET` to use a separate signing key. Keep that key identical across instances; changing it invalidates existing signed sessions.

Deploy the repository, including `api/` and `vercel.json`, rather than only the `dist/` folder. Local SQLite files are excluded from serverless function bundles. SQLite application data still requires a persistent backend for production; signed login sessions do not make the serverless filesystem persistent.

## Admin desk: top-ups, alerts and user balances

Player balances live on the server, in the `users` table. The browser only caches them. Every change is written to `wallet_transactions`, so a user's history always explains their balance.

- **Top-up alerts.** When a player submits a UTR, the Admin Desk plays a sound, shows a pop-up and adds the request under **Alerts**. Desktop notifications appear too once you click *Enable desktop alerts*. Withdrawal requests raise the same alerts.
- **Verify a top-up.** Find the UTR in your UPI or bank statement, then click **Approve** under *Payments* to credit the coins. **Reject** takes a reason, which the player sees. A UTR can only be claimed once.
- **User lookup.** Under *Users*, enter a user key (email or phone) or a gamer tag. The user page shows the player's balances, wallet history, top-ups, withdrawals and matches. From there you can add or deduct credit or winning coins; a balance can never go below zero.
- **Withdrawals.** A request holds the player's winning coins straight away. **Mark paid** after you send the money; **Reject** refunds the coins.
- **Match fees.** The server charges the stored entry fee when a player joins. Deleting a match refunds every player who joined it.

## Sign-up OTP

New players verify their mobile number or email before the account is created:

1. The sign-up form posts to `/api/auth/otp/send`. The server checks the email, number and gamer tag are free, sends a 6-digit code and returns a signed `otpToken`.
2. The player types the code in the box that appears under the form. `/api/users/register` creates the account only when the code matches that token and that exact email or number.

Codes expire after 10 minutes. A number or email gets one code every 30 seconds and five an hour, and a code locks after five wrong tries. The token is signed with `OTP_SECRET` (falling back to `ADMIN_SESSION_SECRET`), so it verifies on any serverless instance; keep that secret identical everywhere.

Providers, set in `.env` and in the Vercel environment variables:

- **SMS:** `FAST2SMS_API_KEY` for Indian (+91) numbers, or `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM` (or `TWILIO_MESSAGING_SERVICE_SID`) for any country.
- **Email:** `RESEND_API_KEY` and `OTP_EMAIL_FROM`, on a domain verified in Resend.

Without a provider, `npm run dev` shows the code on screen so you can test. A deployed site refuses to sign up through a channel with no provider, unless you set `OTP_DEV_MODE=true` for a test deploy.

## Vercel deployment

Vercel deploys one serverless function, `api/index.js`. `vercel.json` rewrites every `/api/*` request to it and `server.js` routes the request. `.vercelignore` leaves the other files in `api/` out of the deployment, because the Hobby plan allows at most 12 functions per deployment.

Set `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` in the Vercel project environment variables. Admin login is disabled when `ADMIN_PASSWORD` is not set.

Run `npm test` or `node --test tests/admin-login.test.js` to check login routing, authentication, token validation, and sessions across separate API instances.
