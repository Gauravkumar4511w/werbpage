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

## Vercel deployment

Vercel deploys one serverless function, `api/index.js`. `vercel.json` rewrites every `/api/*` request to it and `server.js` routes the request. `.vercelignore` leaves the other files in `api/` out of the deployment, because the Hobby plan allows at most 12 functions per deployment.

Set `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` in the Vercel project environment variables. Admin login is disabled when `ADMIN_PASSWORD` is not set.

Run `npm test` or `node --test tests/admin-login.test.js` to check login routing, authentication, token validation, and sessions across separate API instances.
