import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, Check, ChevronDown, Menu, Minus, Plus, ShoppingBag, X } from 'lucide-react'
import { naira, products as demoProducts, type Product } from './data'
import { useAuth } from './lib/useAuth'
import { isBackendConfigured, isProduction } from './lib/supabase'
import {
  BackendError,
  createServerOrder,
  fetchOrderHistory,
  loadCatalog,
  resendConfirmation,
  type CheckoutContact,
  type OrderHistoryEntry,
} from './lib/shopApi'

type CartItem = { productId: string; quantity: number }
type LocalOrder = { id: string; date: string; total: number; items: CartItem[] }
type View = 'shop' | 'product' | 'checkout' | 'orders'
const storageKey = 'jfas-cart-v1'
const heroPrimary = 'https://images.pexels.com/photos/9675234/pexels-photo-9675234.jpeg?cs=srgb&dl=pexels-drakenicolls-9675234.jpg&fm=jpg'
const heroFallback = 'https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=2200&q=90'

const emptyContact: CheckoutContact = {
  email: '',
  fullName: '',
  phone: '',
  address: '',
  city: '',
  state: '',
}

export default function App() {
  const [cart, setCart] = useState<CartItem[]>(() => { try { return JSON.parse(localStorage.getItem(storageKey) || '[]') as CartItem[] } catch { return [] } })
  const [view, setView] = useState<View>('shop')
  const [selected, setSelected] = useState<Product | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [filter, setFilter] = useState('All pieces')
  const [toast, setToast] = useState('')
  const [catalog, setCatalog] = useState<Product[]>(demoProducts)
  const [contact, setContact] = useState<CheckoutContact>(emptyContact)
  const [localOrders, setLocalOrders] = useState<LocalOrder[]>(() => { try { return JSON.parse(localStorage.getItem('jfas-orders-v1') || '[]') as LocalOrder[] } catch { return [] } })
  const [serverOrders, setServerOrders] = useState<OrderHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [placing, setPlacing] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [emailWarning, setEmailWarning] = useState('')
  const [resending, setResending] = useState('')
  const [authError, setAuthError] = useState('')
  const [heroSrc, setHeroSrc] = useState(heroPrimary)
  const auth = useAuth()
  const prefilledFor = useRef<string | null>(null)
  const authOpener = useRef<HTMLElement | null>(null)
  const authCloseRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(cart)) }, [cart])
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 2400); return () => clearTimeout(timer) }, [toast])
  useEffect(() => { loadCatalog().then(setCatalog).catch(() => setCatalog(demoProducts)) }, [])
  useEffect(() => {
    const id = auth.user?.id ?? null
    if (id && auth.user?.email && prefilledFor.current !== id && !contact.email) {
      prefilledFor.current = id
      setContact((c) => ({ ...c, email: auth.user?.email ?? '' }))
    }
    if (!id) prefilledFor.current = null
  }, [auth.user, contact.email])
  useEffect(() => {
    if (!cartOpen && !authOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setCartOpen(false); setAuthOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cartOpen, authOpen])
  useEffect(() => {
    if (authOpen) authCloseRef.current?.focus()
    else if (authOpener.current) {
      authOpener.current.focus()
      authOpener.current = null
    }
  }, [authOpen])

  const reloadHistory = async () => {
    if (!isBackendConfigured || !auth.user) return
    setHistoryLoading(true)
    setHistoryError('')
    try {
      setServerOrders(await fetchOrderHistory())
    } catch (err) {
      setHistoryError(err instanceof BackendError ? err.message : 'Could not load your orders')
    } finally {
      setHistoryLoading(false)
    }
  }
  useEffect(() => {
    if (isBackendConfigured && auth.user) void reloadHistory()
    if (!auth.user) setServerOrders([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user])

  const findProduct = (id: string) => catalog.find((p) => p.id === id) ?? demoProducts.find((p) => p.id === id)
  const count = cart.reduce((n, item) => n + item.quantity, 0)
  const subtotal = cart.reduce((n, item) => n + (findProduct(item.productId)?.price || 0) * item.quantity, 0)
  const visibleProducts = filter === 'All pieces' ? catalog : catalog.filter((p) => p.category === filter)
  const goShop = () => { setView('shop'); setSelected(null); setCartOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const add = (product: Product, quantity = 1) => { setCart((current) => { const line = current.find((i) => i.productId === product.id); return line ? current.map((i) => i.productId === product.id ? { ...i, quantity: i.quantity + quantity } : i) : [...current, { productId: product.id, quantity }] }); setToast(`${product.name} added to your bag`) }
  const changeQty = (id: string, delta: number) => setCart((current) => current.map((i) => i.productId === id ? { ...i, quantity: i.quantity + delta } : i).filter((i) => i.quantity > 0))
  const openProduct = (product: Product) => { setSelected(product); setView('product'); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const setField = (key: keyof CheckoutContact) => (value: string) => setContact((c) => ({ ...c, [key]: value }))

  /** Demo fallback used only when Supabase is not configured. */
  const finishDemoOrder = () => {
    if (!contact.email.trim()) { setCheckoutError('Enter your email to continue'); return }
    const order = { id: `JF-${Date.now().toString().slice(-7)}`, date: new Date().toISOString(), total: subtotal, items: cart }
    const updated = [order, ...localOrders]
    setLocalOrders(updated)
    localStorage.setItem('jfas-orders-v1', JSON.stringify(updated))
    setCart([])
    setView('orders')
    setToast('Your order is confirmed')
  }

  const placeOrder = async () => {
    setCheckoutError('')
    setEmailWarning('')
    if (cart.length === 0) { setCheckoutError('Your bag is empty'); return }
    if (!contact.email.trim()) { setCheckoutError('Enter your email to continue'); return }
    if (!isBackendConfigured) {
      // Production never takes fake demo orders; dev keeps the offline fallback.
      if (isProduction) { setCheckoutError('Checkout is unavailable right now. Please try again shortly.'); return }
      finishDemoOrder()
      return
    }
    if (!auth.user) { setCheckoutError('Sign in with Google to place an order'); return }
    setPlacing(true)
    try {
      const { order, emailWarning: warning } = await createServerOrder(
        cart.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        contact,
      )
      setCart([])
      setView('orders')
      setToast(`Order ${order.order_number} confirmed`)
      if (warning) setEmailWarning(`Order saved, but the receipt email failed (${warning}). Use Resend receipt below.`)
      await reloadHistory()
    } catch (err) {
      setCheckoutError(err instanceof BackendError ? err.message : 'Checkout failed, try again')
    } finally {
      setPlacing(false)
    }
  }

  const handleResend = async (orderId: string) => {
    setResending(orderId)
    try {
      await resendConfirmation(orderId)
      setToast('Receipt resent — check your inbox')
      await reloadHistory()
    } catch (err) {
      setToast(err instanceof BackendError ? err.message : 'Could not resend the receipt')
    } finally {
      setResending('')
    }
  }

  const handleSignIn = async () => {
    setAuthError('')
    try {
      await auth.signInWithGoogle()
    } catch {
      setAuthError('Google sign-in is not available yet')
    }
  }
  const openAuth = () => {
    setAuthError('')
    authOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setAuthOpen(true)
  }

  const ordersNote = !isBackendConfigured
    ? isProduction
      ? 'Order history is currently unavailable. Please check back shortly.'
      : 'Demo mode: orders are stored only in this browser. Connect Supabase to sign in and keep them across sessions.'
    : auth.loading
      ? 'Checking your session…'
      : auth.user
        ? `Signed in as ${auth.user.email}. Orders persist across sessions.`
        : 'Sign in with Google to place orders and view your order history.'

  return (
    <>
      <div className="announcement">Complimentary delivery on orders over ₦50,000 <span>·</span> Lagos, Nigeria</div>
      <header className="header">
        <button className="icon-button mobile-menu" aria-label="Open menu" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}><Menu size={20} /></button>
        <nav className={`nav-links ${mobileOpen ? 'open' : ''}`}>
          <button onClick={goShop}>Shop all</button>
          <button onClick={() => { setFilter('Jewelry'); goShop() }}>Jewelry</button>
          <button onClick={() => { setFilter('Bags'); goShop() }}>Bags & more</button>
          <button onClick={() => { setView('orders'); setMobileOpen(false) }}>My orders</button>
          {auth.user
            ? <button onClick={() => void auth.signOut()}>Sign out</button>
            : <button onClick={() => { setMobileOpen(false); openAuth() }}>Sign in</button>}
        </nav>
        <button className="wordmark" onClick={goShop} aria-label="J-FAS home">J-FAS<span>®</span></button>
        <div className="header-actions">
          {!auth.loading && (auth.user
            ? <button className="account-link" title={auth.user.email ?? ''} onClick={() => { void auth.signOut() }}>Sign out</button>
            : <button className="account-link" onClick={openAuth}>Sign in</button>)}
          <button className="account-link" onClick={() => setView('orders')}>Account</button>
          <button className="icon-button bag-trigger" aria-label={`Shopping bag, ${count} items`} onClick={() => setCartOpen(true)}><ShoppingBag size={19} /><span>Bag ({count})</span></button>
        </div>
      </header>

      <main>
        {view === 'shop' && (
          <>
            <section className="hero">
              <img className="hero-image" src={heroSrc} onError={() => { if (heroSrc !== heroFallback) setHeroSrc(heroFallback) }} alt="A woman in a hijab wearing jewelry, photographed in soft studio light" />
              <div className="hero-shade" />
              <div className="hero-copy"><p className="eyebrow light">THE EVERYDAY, ELEVATED</p><h1>Made to be<br />kept close.</h1><p>Jewelry and objects for the way you want to feel.</p><button className="light-button" onClick={() => document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth' })}>Discover the collection <ArrowRight size={16} /></button></div>
              <span className="hero-index">01 — 04</span><a className="scroll-cue" href="#shop"><ArrowDown size={14} /> SCROLL TO EXPLORE</a>
            </section>

            <section className="intro"><p className="eyebrow">A LITTLE MORE YOU</p><p className="intro-line">The pieces you reach for without thinking.<br /><em>And remember wearing.</em></p><span>Thoughtfully chosen. Always in season.</span></section>

            <section className="shop-section" id="shop">
              <div className="section-heading"><div><p className="eyebrow">THE J-FAS EDIT</p><h2>Find your forever piece.</h2></div><button className="text-link" onClick={() => setFilter('All pieces')}>Shop the collection <ArrowRight size={15} /></button></div>
              <div className="filters">{['All pieces', 'Jewelry', 'Bags', 'Accessories'].map((category) => <button className={filter === category ? 'active' : ''} key={category} aria-pressed={filter === category} onClick={() => setFilter(category)}>{category}</button>)}<span className="result-count">{visibleProducts.length} pieces</span></div>
              <div className="product-grid">{visibleProducts.map((product) => <ProductCard key={product.id} product={product} onOpen={openProduct} onAdd={() => add(product)} />)}</div>
              {visibleProducts.length === 0 && <p className="empty-state">We’re curating this edit now. Check back soon.</p>}
            </section>
            <section className="editorial"><div className="editorial-image"><img src="https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=1100&q=85" alt="A close detail of a gold statement ring" /></div><div className="editorial-copy"><p className="eyebrow">THE ART OF THE EVERYDAY</p><h2>Small details.<br /><em>Lasting feeling.</em></h2><p>For the slow mornings, the last-minute plans, and every version of you in between. Meet pieces made to move with you.</p><button className="dark-button" onClick={() => { setFilter('Jewelry'); document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth' }) }}>Explore jewelry <ArrowRight size={15} /></button></div></section>
            <section className="newsletter"><p className="eyebrow">A NOTE FROM US</p><h2>Good things, occasionally.</h2><p>New pieces, styling notes, and the little things we love. No noise.</p><form onSubmit={(e) => { e.preventDefault(); setToast('You’re on the list — welcome') }}><input type="email" required placeholder="Your email address" aria-label="Email address" /><button type="submit">Sign me up <ArrowRight size={14} /></button></form><small>By subscribing, you agree to receive our occasional notes.</small></section>
          </>
        )}

        {view === 'product' && selected && <ProductDetail product={selected} catalog={catalog} onBack={goShop} onAdd={add} onOpen={openProduct} />}

        {view === 'checkout' && (
          <section className="checkout-page">
            <button className="back-link" onClick={() => setCartOpen(true)}><ArrowLeft size={15} /> Back to bag</button>
            <div className="checkout-layout">
              <div>
                <p className="eyebrow">ALMOST YOURS</p>
                <h1>Checkout</h1>
                <p className="checkout-note">
                  {isBackendConfigured
                    ? auth.user
                      ? 'Your total is verified by our server and your receipt is emailed after checkout.'
                      : 'Sign in with Google to place a secure order — your total is verified server-side.'
                    : isProduction
                      ? 'Checkout is currently unavailable. Please check back shortly.'
                      : 'Sign-in will be connected to Supabase. Enter your email to prepare this demo order.'}
                </p>
                {isBackendConfigured && !auth.loading && !auth.user && (
                  <button className="dark-button" onClick={openAuth}>Sign in with Google <ArrowRight size={15} /></button>
                )}
                <label className="field-label">Email address<input type="email" placeholder="you@example.com" value={contact.email} onChange={(e) => setField('email')(e.target.value)} /></label>
                <div className="checkout-section">
                  <h3>Delivery details</h3>
                  <div className="field-grid">
                    <label className="field-label">Full name<input placeholder="Your name" value={contact.fullName} onChange={(e) => setField('fullName')(e.target.value)} /></label>
                    <label className="field-label">Phone number<input placeholder="+234" value={contact.phone} onChange={(e) => setField('phone')(e.target.value)} /></label>
                  </div>
                  <label className="field-label">Delivery address<input placeholder="Street address, area" value={contact.address} onChange={(e) => setField('address')(e.target.value)} /></label>
                  <div className="field-grid">
                    <label className="field-label">City<input placeholder="Lagos" value={contact.city} onChange={(e) => setField('city')(e.target.value)} /></label>
                    <label className="field-label">State<input placeholder="Lagos" value={contact.state} onChange={(e) => setField('state')(e.target.value)} /></label>
                  </div>
                </div>
                <div className="checkout-section"><h3>Payment</h3><p className="payment-placeholder">Payment options will be available when checkout is connected.</p></div>
                {checkoutError && <p className="form-error" role="alert">{checkoutError}</p>}
                {emailWarning && <p className="form-warning" role="alert">{emailWarning}</p>}
              </div>
              <aside className="checkout-summary">
                <h3>Your order</h3>
                {cart.map((item) => {
                  const p = findProduct(item.productId)
                  return p ? <div className="summary-item" key={p.id}><img src={p.image} alt="" /><div>{p.name}<small>Qty {item.quantity}</small></div><span>{naira(p.price * item.quantity)}</span></div> : null
                })}
                <div className="summary-total"><span>Estimated subtotal</span><b>{naira(subtotal)}</b></div>
                <div className="summary-total muted"><span>Delivery</span><span>Calculated by the server</span></div>
                <button className="dark-button full" disabled={placing} onClick={() => void placeOrder()}>
                  {placing ? 'Placing your order…' : isBackendConfigured ? 'Place secure order' : isProduction ? 'Checkout unavailable' : 'Place demo order'} <ArrowRight size={15} />
                </button>
                {isBackendConfigured && <small className="secure-note">Your final total and order are verified by our server at checkout.</small>}
              </aside>
            </div>
          </section>
        )}

        {view === 'orders' && (
          <section className="orders-page">
            <p className="eyebrow">YOUR J-FAS</p>
            <h1>Order history</h1>
            <p className="checkout-note">{ordersNote}</p>
            {isBackendConfigured && auth.loading && (
              <p className="checkout-note">Checking your session…</p>
            )}
            {isBackendConfigured && !auth.loading && !auth.user && (
              <button className="dark-button" onClick={openAuth}>Sign in with Google <ArrowRight size={15} /></button>
            )}
            {isBackendConfigured && auth.user && (
              <>
                {historyLoading && <p className="checkout-note">Loading your orders…</p>}
                {historyError && <p className="form-error" role="alert">{historyError}</p>}
                {!historyLoading && !historyError && (serverOrders.length ? (
                  <div className="order-list">
                    {serverOrders.map((order) => (
                      <article className="order-card" key={order.id}>
                        <div className="order-top">
                          <div><b>Order {order.order_number}</b><span>{new Date(order.created_at).toLocaleDateString('en-NG', { dateStyle: 'long' })}</span></div>
                          <strong>{naira(order.total)}</strong>
                        </div>
                        <div className="order-products">{order.items.map((line) => <span key={line.productId}>{line.name} × {line.quantity}</span>)}</div>
                        <div className="order-status"><Check size={14} /> Order confirmed{order.email_status === 'failed' ? ' · receipt failed' : ''}</div>
                        {order.email_status === 'failed' && (
                          <button className="text-link" disabled={resending === order.id} onClick={() => void handleResend(order.id)}>
                            {resending === order.id ? 'Resending…' : 'Resend receipt'}
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="orders-empty"><div className="empty-bag"><ShoppingBag size={24} /></div><h2>Your story starts here.</h2><p>Once you’ve placed an order, you’ll find it here.</p><button className="dark-button" onClick={goShop}>Explore the collection <ArrowRight size={15} /></button></div>
                ))}
              </>
            )}
            {!isBackendConfigured && (localOrders.length ? (
              <div className="order-list">
                {localOrders.map((order) => (
                  <article className="order-card" key={order.id}>
                    <div className="order-top"><div><b>Order {order.id}</b><span>{new Date(order.date).toLocaleDateString('en-NG', { dateStyle: 'long' })}</span></div><strong>{naira(order.total)}</strong></div>
                    <div className="order-products">{order.items.map((line) => { const p = findProduct(line.productId); return p ? <span key={p.id}>{p.name} × {line.quantity}</span> : null })}</div>
                    <div className="order-status"><Check size={14} /> Order confirmed</div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="orders-empty"><div className="empty-bag"><ShoppingBag size={24} /></div><h2>Your story starts here.</h2><p>Once you’ve placed an order, you’ll find it here.</p><button className="dark-button" onClick={goShop}>Explore the collection <ArrowRight size={15} /></button></div>
            ))}
          </section>
        )}
      </main>

      <footer className="footer">
        <div className="footer-top"><div><button className="wordmark footer-logo" onClick={goShop}>J-FAS<span>®</span></button><p>Pieces to make your own.<br />Lagos, Nigeria.</p></div><div className="footer-links"><div><b>Explore</b><button onClick={goShop}>Shop all</button><button onClick={() => { setFilter('Jewelry'); goShop() }}>Jewelry</button><button onClick={() => { setFilter('Bags'); goShop() }}>Bags & more</button></div><div><b>Help</b><button onClick={() => setView('orders')}>My orders</button><a href="mailto:hello@jfas.ng">Get in touch</a><span>Shipping & returns</span></div><div><b>Follow along</b><a href="https://www.instagram.com/jewelry_and_fashion_store/" target="_blank" rel="noreferrer">Instagram ↗</a><span>@jewelry_and_fashion_store</span></div></div></div>
        <div className="footer-bottom"><span>© 2026 J-FAS. Made with intention.</span><span>Privacy · Terms</span><span>LAGOS · NIGERIA</span></div>
      </footer>

      {cartOpen && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setCartOpen(false) }}>
          <aside className="cart-drawer" role="dialog" aria-modal="true" aria-label="Shopping bag">
            <div className="drawer-head"><div><p className="eyebrow">YOUR SELECTION</p><h2>Your bag <span>({count})</span></h2></div><button className="icon-button" aria-label="Close bag" onClick={() => setCartOpen(false)}><X size={20} /></button></div>
            {cart.length ? (
              <>
                <div className="cart-lines">
                  {cart.map((item) => {
                    const p = findProduct(item.productId)
                    return p ? (
                      <article className="cart-line" key={p.id}>
                        <button className="cart-image" onClick={() => { setCartOpen(false); openProduct(p) }}><img src={p.image} alt={p.name} /></button>
                        <div className="cart-line-info">
                          <button className="line-name" onClick={() => { setCartOpen(false); openProduct(p) }}>{p.name}</button>
                          <span>{naira(p.price)}</span>
                          <div className="qty-control"><button aria-label="Decrease quantity" onClick={() => changeQty(p.id, -1)}><Minus size={12} /></button><span>{item.quantity}</span><button aria-label="Increase quantity" onClick={() => changeQty(p.id, 1)}><Plus size={12} /></button></div>
                        </div>
                        <button className="remove-line" aria-label={`Remove ${p.name}`} onClick={() => setCart((current) => current.filter((i) => i.productId !== p.id))}>Remove</button>
                      </article>
                    ) : null
                  })}
                </div>
                <div className="drawer-bottom">
                  <div className="subtotal-line"><span>Subtotal</span><strong>{naira(subtotal)}</strong></div>
                  <p>Delivery and any applicable fees are calculated at checkout.</p>
                  <button className="dark-button full" onClick={() => { setCartOpen(false); setView('checkout'); window.scrollTo(0, 0) }}>Continue to checkout <ArrowRight size={15} /></button>
                  <button className="continue-shopping" onClick={() => setCartOpen(false)}>Continue shopping</button>
                </div>
              </>
            ) : (
              <div className="cart-empty"><div className="empty-bag"><ShoppingBag size={24} /></div><h3>A little room for something lovely.</h3><p>Your bag is waiting for its first piece.</p><button className="dark-button" onClick={() => { setCartOpen(false); goShop() }}>Explore the collection <ArrowRight size={15} /></button></div>
            )}
          </aside>
        </div>
      )}
      {authOpen && (
        <div className="overlay auth-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setAuthOpen(false) }}>
          <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <button ref={authCloseRef} className="icon-button auth-close" aria-label="Close sign in" onClick={() => setAuthOpen(false)}><X size={20} /></button>
            <p className="eyebrow">YOUR J-FAS ACCOUNT</p>
            <h2 id="auth-title">Keep your pieces<br /><em>close.</em></h2>
            <p>Sign in to place secure orders, keep your order history, and receive your receipts.</p>
            {auth.configured ? (
              <button className="dark-button full" disabled={auth.loading} onClick={() => void handleSignIn()}>
                {auth.loading ? 'Checking your session…' : 'Continue with Google'} <ArrowRight size={15} />
              </button>
            ) : isProduction ? (
              <div className="auth-setup" role="status">
                <strong>Sign-in is unavailable</strong>
                <span>We are having trouble reaching our sign-in service. Please try again shortly.</span>
              </div>
            ) : (
              <div className="auth-setup" role="status">
                <strong>Google sign-in needs setup</strong>
                <span>Add the Supabase URL and anon key to your local <code>.env</code>, then restart the app. This storefront will not simulate a login.</span>
              </div>
            )}
            <small>Google creates a new account on your first visit or signs you into your existing one.</small>
            {authError && <p className="form-error" role="alert">{authError}</p>}
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    </>
  )
}

function ProductCard({ product, onOpen, onAdd }: { product: Product; onOpen: (p: Product) => void; onAdd: () => void }) {
  return (
    <article className="product-card">
      <button className="product-image" onClick={() => onOpen(product)}><img src={product.image} alt={product.name} loading="lazy" />{product.badge && <span className="badge">{product.badge}</span>}<span className="quick-add">Quick add <Plus size={14} /></span></button>
      <div className="product-meta"><div><span className="product-category">{product.category} · {product.color}</span><button className="product-name" onClick={() => onOpen(product)}>{product.name}</button></div><strong>{naira(product.price)}</strong></div>
      <button className="mobile-add" onClick={onAdd}>Add to bag <Plus size={13} /></button>
    </article>
  )
}

function ProductDetail({ product, catalog, onBack, onAdd, onOpen }: { product: Product; catalog: Product[]; onBack: () => void; onAdd: (p: Product, q?: number) => void; onOpen: (p: Product) => void }) {
  const [quantity, setQuantity] = useState(1)
  return (
    <section className="detail-page">
      <button className="back-link" onClick={onBack}><ArrowLeft size={15} /> Back to collection</button>
      <div className="detail-layout">
        <div className="detail-photo"><img src={product.image} alt={product.name} /></div>
        <div className="detail-info">
          <p className="eyebrow">{product.category.toUpperCase()} · {product.color.toUpperCase()}</p>
          <h1>{product.name}</h1>
          <strong className="detail-price">{naira(product.price)}</strong>
          <p className="detail-description">{product.description}</p>
          <p className="detail-delivery">Complimentary delivery on orders over ₦50,000.</p>
          <div className="detail-quantity"><span>Quantity</span><div className="qty-control"><button aria-label="Decrease quantity" onClick={() => setQuantity(Math.max(1, quantity - 1))}><Minus size={12} /></button><span>{quantity}</span><button aria-label="Increase quantity" onClick={() => setQuantity(quantity + 1)}><Plus size={12} /></button></div></div>
          <button className="dark-button full" onClick={() => onAdd(product, quantity)}>Add to bag — {naira(product.price * quantity)} <ShoppingBag size={15} /></button>
          <div className="detail-accordion">
            <details open><summary>Details <ChevronDown size={14} /></summary><p>Designed to be worn on repeat. Each J-FAS piece is carefully selected for its considered shape and lasting appeal.</p></details>
            <details><summary>Care <ChevronDown size={14} /></summary><p>Keep away from water, perfume, and lotions. Store in a dry place between wears.</p></details>
            <details><summary>Delivery & returns <ChevronDown size={14} /></summary><p>Orders are prepared with care. Delivery options and timing are confirmed at checkout.</p></details>
          </div>
        </div>
      </div>
      <div className="related-heading"><p className="eyebrow">MORE TO LOVE</p><h2>Consider these, too.</h2></div>
      <div className="product-grid related-grid">
        {catalog.filter((p) => p.id !== product.id).slice(0, 4).map((p) => <ProductCard key={p.id} product={p} onOpen={() => { onOpen(p); window.scrollTo(0, 0) }} onAdd={() => onAdd(p)} />)}
      </div>
    </section>
  )
}
