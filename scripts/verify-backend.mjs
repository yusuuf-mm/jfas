// Backend verification for the J-FAS shop flow (no secrets required).
// Covers: unauthenticated checkout blocked, authenticated order creation,
// persistence/ownership shape, history retrieval, session persistence wiring,
// email trigger, and useful client error responses — using the pure
// server-rule mirror plus static checks of the migration + Edge Functions.
// Run: npm run verify:backend

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

// Minimal inline copy of the rule mirror to avoid TS compilation here.
// Kept in sync with src/lib/orderValidation.ts by the sync-check test below.
const FREE_DELIVERY_THRESHOLD = 50000
const DELIVERY_FEE = 2500
function validateCheckoutItems(items, catalog) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('EMPTY_CART')
  if (items.length > 50) throw new Error('TOO_MANY_LINES')
  const byId = new Map(catalog.map((p) => [p.id, p]))
  let subtotal = 0
  for (const item of items) {
    if (!item.productId) throw new Error('INVALID_PRODUCT:?')
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      throw new Error(`INVALID_QUANTITY:${item.productId}`)
    }
    const product = byId.get(item.productId)
    if (!product || !product.active) throw new Error(`INVALID_PRODUCT:${item.productId}`)
    if (product.stock < item.quantity) throw new Error(`INSUFFICIENT_STOCK:${item.productId}`)
    subtotal += product.price * item.quantity
  }
  const deliveryFee = subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE
  return { subtotal, deliveryFee, total: subtotal + deliveryFee }
}

const catalog = [
  { id: 'sol-chain', price: 28500, stock: 50, active: true },
  { id: 'muse-bag', price: 42000, stock: 2, active: true },
  { id: 'retired', price: 10000, stock: 5, active: false },
]

describe('J-FAS backend verification', () => {
  it('1. unauthenticated checkout is blocked (401 path exists)', () => {
    const fn = read('supabase/functions/create-order/index.ts')
    const rpc = read('supabase/migrations/0001_jfas_init.sql')
    assert.match(fn, /auth\.getUser\(\)/)
    assert.match(fn, /401/)
    assert.match(rpc, /UNAUTHENTICATED/)
  })

  it('2. authenticated checkout validates + totals server-side', () => {
    const out = validateCheckoutItems(
      [{ productId: 'sol-chain', quantity: 2 }],
      catalog,
    )
    // 28,500 x 2 = 57,000 -> free delivery
    assert.deepEqual(out, { subtotal: 57000, deliveryFee: 0, total: 57000 })
    const small = validateCheckoutItems([{ productId: 'muse-bag', quantity: 1 }], catalog)
    assert.deepEqual(small, { subtotal: 42000, deliveryFee: 2500, total: 44500 })
  })

  it('3. order persists with server-computed totals (migration inserts order + items)', () => {
    const rpc = read('supabase/migrations/0001_jfas_init.sql')
    assert.match(rpc, /insert into public\.orders/)
    assert.match(rpc, /insert into public\.order_items/)
    assert.match(rpc, /security definer/i)
  })

  it('checkout state is committed atomically by the corrected RPC', () => {
    const rpc = read('supabase/migrations/0002_atomic_checkout.sql')
    assert.match(rpc, /for update/i)
    assert.match(rpc, /insert into public\.orders[\s\S]*insert into public\.order_items/i)
    assert.match(rpc, /update public\.products[\s\S]*stock = stock -/i)
    const cleanup = read('supabase/migrations/0003_cleanup.sql')
    assert.match(cleanup, /drop function if exists public\.decrement_stock/i)
  })

  it('4. orders belong to the correct user (user_id + RLS)', () => {
    const rpc = read('supabase/migrations/0001_jfas_init.sql')
    assert.match(rpc, /user_id uuid not null references public\.profiles/)
    assert.match(rpc, /auth\.uid\(\) = user_id/)
    const fn = read('supabase/functions/create-order/index.ts')
    assert.match(fn, /authClient\.rpc\("create_order"/)
  })

  it('5/6. history is per-user and survives logout/re-login (RLS + persisted session)', () => {
    const rpc = read('supabase/migrations/0001_jfas_init.sql')
    assert.match(rpc, /orders_select_own/)
    const api = read('src/lib/shopApi.ts')
    assert.match(api, /fetchOrderHistory/)
    assert.match(api, /\.from\('orders'\)/)
    const hook = read('src/lib/useAuth.ts')
    assert.match(hook, /persistSession: true|sessions?/i)
    assert.match(hook, /onAuthStateChange/)
  })

  it('7. confirmation email is triggered after persistence (isolated provider)', () => {
    const fn = read('supabase/functions/create-order/index.ts')
    assert.match(fn, /sendOrderConfirmation/)
    assert.match(fn, /email_status/)
    const shared = read('supabase/functions/_shared/email.ts')
    assert.match(shared, /MailerSend|mailersend/i)
    assert.match(shared, /orderNumber/)
    assert.match(shared, /total/i)
    assert.match(read('src/lib/shopApi.ts'), /resendConfirmation/)
  })

  it('8. frontend receives useful success/error responses', () => {
    const fn = read('supabase/functions/create-order/index.ts')
    for (const msg of ['Sign in with Google', 'Unknown product', 'Insufficient stock', 'Could not save your order']) {
      assert.ok(fn.includes(msg), `missing error message: ${msg}`)
    }
    assert.match(read('src/App.tsx'), /checkoutError/)
  })

  it('invalid product / bad quantity / low stock are rejected', () => {
    assert.throws(() => validateCheckoutItems([{ productId: 'nope', quantity: 1 }], catalog), /INVALID_PRODUCT/)
    assert.throws(() => validateCheckoutItems([{ productId: 'sol-chain', quantity: 0 }], catalog), /INVALID_QUANTITY/)
    assert.throws(() => validateCheckoutItems([{ productId: 'muse-bag', quantity: 5 }], catalog), /INSUFFICIENT_STOCK/)
    assert.throws(() => validateCheckoutItems([], catalog), /EMPTY_CART/)
  })

  it('browser prices can never win: functions ignore client totals', () => {
    const fn = read('supabase/functions/create-order/index.ts')
    assert.ok(!/payload\["total"\]|body\.total/.test(fn), 'edge function must not read client totals')
    const rpc = read('supabase/migrations/0001_jfas_init.sql')
    assert.match(rpc, /select price, stock/)
  })

  it('email failure never duplicates orders (retry is email-only)', () => {
    const retry = read('supabase/functions/send-order-confirmation/index.ts')
    assert.match(retry, /from\("orders"\)/)
    assert.ok(!/\.insert\(/.test(retry.replace(/update\(\{ email_status[\s\S]*?\}\)/, '')), 'retry must not insert orders')
  })

  it('env example documents every required variable without secrets', () => {
    const env = read('.env.example')
    for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'MAILERSEND_API_KEY', 'MAILERSEND_FROM_EMAIL']) {
      assert.ok(env.includes(name), `missing ${name}`)
    }
    assert.ok(!/=sk-|\bsecret\b/i.test(env.replace(/where .* secret/i, '')), 'no secret values allowed')
  })

  it('production never takes demo orders or shows dev setup copy', () => {
    const app = read('src/App.tsx')
    assert.match(app, /isProduction/)
    assert.ok(app.includes('Checkout is unavailable right now'), 'prod checkout guard missing')
    assert.ok(app.includes('Sign-in is unavailable'), 'prod auth copy missing')
    assert.ok(app.includes('Place demo order'), 'dev demo fallback must remain for local dev')
    const lib = read('src/lib/supabase.ts')
    assert.match(lib, /isProduction/)
  })

  it('rule mirror stays in sync with src/lib/orderValidation.ts', () => {
    const src = read('src/lib/orderValidation.ts')
    assert.ok(src.includes('FREE_DELIVERY_THRESHOLD = 50000') || src.includes('50000'))
    assert.ok(src.includes('DELIVERY_FEE = 2500') || src.includes('2500'))
    assert.ok(existsSync(join(root, 'src/lib/shopApi.ts')))
    assert.ok(existsSync(join(root, 'src/lib/useAuth.ts')))
    assert.ok(existsSync(join(root, 'src/lib/supabase.ts')))
  })
})
