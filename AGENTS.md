# J-FAS project context

## Purpose
J-FAS is a minimal luxury, editorial jewelry/fashion e-commerce storefront for the HNG 15 Lesson 2 individual task. The primary flow is shop → product → cart → checkout → confirmation/order history.

## Stack
- React 18, TypeScript, Vite
- Plain CSS with responsive breakpoints; Lucide icons
- Demo product photography uses remote Unsplash URLs
- Supabase (Postgres + Auth + Edge Functions) backend integration implemented; requires manual project setup (see below)
- MailerSend confirmation email via isolated module `supabase/functions/_shared/email.ts`

## Architecture
- `src/data.ts`: typed `Product` contract and demo catalog fallback. `loadCatalog` (`src/lib/shopApi.ts`) prefers Supabase `products` and falls back to this catalog when unconfigured/empty.
- `src/lib/supabase.ts`: browser Supabase client (anon key only); `isBackendConfigured` gates backend features.
- `src/lib/useAuth.ts`: Google OAuth session state (sign in/out, persistence via Supabase Auth).
- `src/lib/shopApi.ts`: `loadCatalog`, `createServerOrder` (Edge Function `create-order`), `fetchOrderHistory` (RLS-protected reads), `resendConfirmation` (email-only retry, never duplicates orders).
- `src/lib/orderValidation.ts`: pure mirror of server checkout rules for previews/tests; the Edge Function + `create_order` RPC are authoritative.
- `src/App.tsx`: storefront UI with auth-aware checkout/order history; demo localStorage flow retained only when backend is unconfigured. Production builds (`isProduction`) never take demo orders and show service-unavailable copy instead of dev setup instructions.
- `src/styles.css`: design tokens, responsive layouts, component styling.
- `supabase/migrations/0001_jfas_init.sql`: `profiles`, `products`, `orders`, `order_items` with PKs/FKs/checks/indexes, RLS (users read only own orders/items), `handle_new_user` profile trigger, SECURITY DEFINER `create_order` RPC, `decrement_stock` helper, demo seed data.
- `supabase/migrations/0002_atomic_checkout.sql`: replaces `create_order` with the production checkout transaction: locks stock rows, validates IDs and quantities, computes trusted totals, then inserts the order, inserts lines, and decrements stock atomically.
- `supabase/migrations/0003_cleanup.sql`: drops the now-unused `decrement_stock` helper (0002 inlined the stock update).
- `supabase/functions/create-order/index.ts`: verifies JWT, invokes the authenticated transactional RPC, then sends confirmation email; email failure returns 201 with `email_status: "failed"` + order id for email-only retry.
- `supabase/functions/send-order-confirmation/index.ts`: resends a receipt for an owned order; never inserts orders.
- `supabase/functions/_shared/email.ts`: `OrderConfirmationEmail` interface + `sendOrderConfirmation`; MailerSend sender is the default, Mailgun stub shows the swap point.
- Cart persists in localStorage (`jfas-cart-v1`); demo orders (`jfas-orders-v1`) only when backend unconfigured.

## Design direction
Minimal luxury/editorial: warm paper and sand palette, restrained serif display type, generous whitespace, high-quality product photography, clear purchase controls. Mobile-first navigation and product grids. Avoid generic SaaS visuals, excess gradients, glass effects, clutter, and motion; honor reduced-motion settings.

## Conventions
- Keep product UI dependent on the `Product` interface, not demo-only fields beyond optional presentation metadata.
- Never treat browser cart prices or totals as authoritative. The backend must recalculate from product records.
- Do not add custom password authentication. Supabase Auth should own sessions and Google OAuth.
- Keep transactional email provider logic replaceable behind an order confirmation email interface; intended provider is MailerSend (the HNG guide mentions Mailgun).
- Frontend environment variables use `VITE_` prefix. Never put secrets in client variables or commit `.env` files.
- Prefer focused components and plain CSS; avoid unnecessary frameworks/abstraction.

## Current implementation status
- Implemented storefront, category filters, product detail, add-to-cart, quantity editing/removal, persisted cart, checkout form shell, demo order confirmation and local order history, mobile menu, empty states, newsletter interaction, responsive footer, a dedicated Google account dialog, Escape-to-close + focus handling on overlays, honest demo-mode copy, and favicon/social meta.
- Backend integration implemented: Google OAuth sign in/out with persisted sessions, Supabase catalog reads (fallback to demo catalog), authenticated server-side checkout (trusted prices/totals, stock checks, atomic order + items), per-user RLS order history that survives logout/re-login, MailerSend confirmation email with email-only retry.
- Verified: `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run verify:backend` (14 checks) all pass.
- Live end-to-end (Supabase project, OAuth, deployed functions, email delivery) is pending manual configuration below.

## Manual configuration remaining (nothing else is code)
1. Create a Supabase project; set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env` (see `.env.example`).
2. Apply the migrations: `supabase db push` (or run all SQL files in `supabase/migrations/` in order) to create tables, RLS, the atomic `create_order` RPC, and seed products.
3. Enable Google OAuth: Supabase dashboard → Authentication → Providers → Google (add client ID/secret, redirect to site URL + localhost).
4. Set Edge Function secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MAILERSEND_API_KEY`, `MAILERSEND_FROM_EMAIL`, optional `MAILERSEND_FROM_NAME`/`MAILERSEND_TEMPLATE_ID`) and deploy: `supabase functions deploy create-order` and `supabase functions deploy send-order-confirmation`.
5. Verify with a sender-verified MailerSend domain; place a test order and confirm the receipt email.

## Integration assumptions / TODOs
1. ~~Create Supabase products, orders, and order_items schemas and connect catalog reads.~~ Done (migration + `loadCatalog`); needs live project.
2. ~~Add Supabase Auth (Google OAuth), session state, and protect history/checkout.~~ Done; needs provider setup.
3. ~~Add server-side checkout endpoint/function that validates identity, stock, product prices, and totals; persist order and line items atomically.~~ Done (Edge Function + `create_order` RPC fallback).
4. Add real delivery/address and payment flow as defined by backend/product requirements.
5. ~~Add replaceable transactional-email adapter; use MailerSend implementation after order persistence, with credentials server-side only.~~ Done; needs API key + verified sender.
6. Replace temporary product imagery with approved J-FAS product assets; the homepage hero uses a respectful, jewelry-focused hijab model reference from Pexels, while product cards remain product-only images.
7. ~~Add robust loading/error states for network-backed catalog, auth, checkout, and orders.~~ Done (loading/error/empty states, resend-receipt retry).

## Commands
- `npm install` — install dependencies
- `npm run dev` — local development server
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript project check
- `npm run build` — typecheck and production build
- `npm run verify:backend` — 14 backend verification checks (no secrets needed)

## Remaining backend dependencies
Live Supabase project URL/key, applied migration, Google OAuth provider setup, deployed Edge Functions, and MailerSend API key + verified sender domain are pending (manual steps above). `.env.example` intentionally contains placeholders only; store real values in ignored local files or Supabase Function secrets. No code work remains for the required flow.
