# J-FAS project context

## Purpose
J-FAS is a minimal luxury, editorial jewelry/fashion e-commerce storefront for the HNG 15 Lesson 2 individual task. The primary flow is shop → product → cart → checkout → confirmation/order history.

## Stack
- React 18, TypeScript, Vite
- Plain CSS with responsive breakpoints; Lucide icons
- Demo product photography uses remote Unsplash URLs
- Supabase and MailerSend are planned backend integrations and are not configured

## Architecture
- `src/data.ts`: typed `Product` contract, local demo catalog, currency formatter. Replace catalog access with a Supabase repository while retaining the interface.
- `src/App.tsx`: current single-page route/view state, product listing/detail, local cart, demo checkout, order history, header/footer.
- `src/styles.css`: design tokens, responsive layouts, component styling.
- Cart and demo orders persist in localStorage (`jfas-cart-v1`, `jfas-orders-v1`).

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
- Implemented storefront, category filters, product detail, add-to-cart, quantity editing/removal, persisted cart, checkout form shell, demo order confirmation and local order history, mobile menu, empty states, newsletter interaction, responsive footer.
- Auth is only a UI placeholder: order history is local and checkout demo accepts an email. No real identity, payment, delivery integration, or server order validation exists.
- Checkout demo order is not a real purchase and sends no email.
- Verification is pending: npm registry access/dependency installation did not complete in this environment, so lint, typecheck, build, and browser-flow checks could not run.

## Integration assumptions / TODOs
1. Create Supabase products, orders, and order_items schemas and connect catalog reads.
2. Add Supabase Auth (Google OAuth), session state, and protect history/checkout. Do not introduce password auth.
3. Add server-side checkout endpoint/function that validates identity, stock, product prices, and totals; persist order and line items atomically.
4. Add real delivery/address and payment flow as defined by backend/product requirements.
5. Add replaceable transactional-email adapter; use MailerSend implementation after order persistence, with credentials server-side only.
6. Replace temporary Unsplash assets with approved J-FAS imagery; review product names, prices, currency, and delivery thresholds with the business.
7. Add robust loading/error states for network-backed catalog, auth, checkout, and orders.

## Commands
- `npm install` — install dependencies
- `npm run dev` — local development server
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript project check
- `npm run build` — typecheck and production build

## Remaining backend dependencies
Supabase project URL/key, catalog schema/data, Google OAuth provider setup, protected server-side order creation and total validation, payment/delivery integration, and MailerSend server credentials/API integration are all pending.
