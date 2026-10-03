# J-FAS

Minimal luxury jewelry and fashion storefront for the HNG 15 Lesson 2 individual task. Mobile-first React/TypeScript MVP: browse products → cart → authenticated checkout → persistent Supabase orders → MailerSend confirmation email → per-user order history.

## Run locally

```sh
npm install
npm run dev
```

Checks: `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run verify:backend` (13 backend checks, no secrets needed).

Without Supabase env vars the app runs in demo mode (local catalog + localStorage orders). With `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set, it uses Google OAuth, server-side checkout, and persistent per-user order history.

## Backend setup (manual, ~15 min)

1. Create a Supabase project; copy URL + anon key into `.env` (see `.env.example`).
2. Apply `supabase/migrations/0001_jfas_init.sql` (tables, RLS, `create_order`, seed products).
3. Enable Google OAuth (Authentication → Providers → Google).
4. Set function secrets and deploy:
   ```sh
   supabase functions deploy create-order
   supabase functions deploy send-order-confirmation
   ```
   Secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MAILERSEND_API_KEY`, `MAILERSEND_FROM_EMAIL` (plus optional `MAILERSEND_FROM_NAME`, `MAILERSEND_TEMPLATE_ID`).
5. Place a test order and confirm the receipt email arrives.

See [AGENTS.md](./AGENTS.md) for architecture, integration assumptions, status, and next steps.
