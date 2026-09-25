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
