import { products as demoProducts, type Product } from '../data'
import { getSupabase } from './supabase'

export interface CheckoutItem {
  productId: string
  quantity: number
}

export interface CheckoutContact {
  email: string
  fullName: string
  phone: string
  address: string
  city: string
  state: string
}

export interface ServerOrderItem {
  product_id: string
  name: string
  quantity: number
  unit_price: number
  line_total: number
}

export interface ServerOrder {
  id: string
  order_number: string
  subtotal: number
  delivery_fee: number
  total: number
  status: string
  email_status: string
  created_at: string
}

export interface OrderHistoryEntry extends ServerOrder {
  email: string
  items: { productId: string; quantity: number; name: string }[]
}

export class BackendError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'BackendError'
    this.status = status
  }
}

function requireClient() {
  const supabase = getSupabase()
  if (!supabase) throw new BackendError('Checkout is not configured yet', 503)
  return supabase
}

/** Catalogue: Supabase products when configured, demo catalogue otherwise. */
export async function loadCatalog(): Promise<Product[]> {
  const supabase = getSupabase()
  if (!supabase) return demoProducts
  const { data, error } = await supabase
    .from('products')
    .select('id,name,category,price,image,description,badge,color')
    .eq('active', true)
    .order('name')
  if (error || !data || data.length === 0) return demoProducts
  return data.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    category: (row.category as Product['category']) ?? 'Jewelry',
    price: Number(row.price),
    image: String(row.image),
    description: String(row.description ?? ''),
    badge: (row.badge as string | undefined) ?? undefined,
    color: String(row.color ?? ''),
  }))
}

/**
 * Authenticated server-side checkout. Sends only product IDs + quantities;
 * the Edge Function verifies identity, reads trusted prices, totals
 * server-side, persists order + items, and triggers the confirmation email.
 */
export async function createServerOrder(
  items: CheckoutItem[],
  contact: CheckoutContact,
): Promise<{ order: ServerOrder; items: ServerOrderItem[]; emailWarning?: string }> {
  const supabase = requireClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new BackendError('Sign in with Google to place an order', 401)

  const { data, error } = await supabase.functions.invoke('create-order', {
    body: {
      items: items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
      email: contact.email,
      full_name: contact.fullName,
      phone: contact.phone,
      address: contact.address,
      city: contact.city,
      state: contact.state,
    },
  })
  if (error) {
    const status = (error as { status?: number }).status ?? 500
    const message =
      (typeof data === 'object' && data && (data as { error?: string }).error) ||
      error.message ||
      'Checkout failed, try again'
    throw new BackendError(message, status)
  }
  const payload = data as {
    order: ServerOrder
    items: ServerOrderItem[]
    email_warning?: string
  }
  return { order: payload.order, items: payload.items, emailWarning: payload.email_warning }
}

/** Orders belonging to the signed-in user (RLS enforces ownership). */
export async function fetchOrderHistory(): Promise<OrderHistoryEntry[]> {
  const supabase = requireClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new BackendError('Sign in to view your orders', 401)

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id,order_number,email,subtotal,delivery_fee,total,status,email_status,created_at')
    .order('created_at', { ascending: false })
  if (error) throw new BackendError('Could not load your orders', 500)

  const ids = (orders ?? []).map((o) => o.id as string)
  if (ids.length === 0) return []
  const { data: lines, error: linesError } = await supabase
    .from('order_items')
    .select('order_id,product_id,quantity,products(name)')
    .in('order_id', ids)
  if (linesError) throw new BackendError('Could not load your orders', 500)

  const byOrder = new Map<string, OrderHistoryEntry['items']>()
  for (const row of lines ?? []) {
    const list = byOrder.get(row.order_id as string) ?? []
    list.push({
      productId: String(row.product_id),
      quantity: Number(row.quantity),
      name: String((row.products as unknown as { name?: string } | null)?.name ?? 'J-FAS piece'),
    })
    byOrder.set(row.order_id as string, list)
  }
  return (orders ?? []).map((o) => ({
    id: String(o.id),
    order_number: String(o.order_number),
    email: String(o.email ?? ''),
    subtotal: Number(o.subtotal),
    delivery_fee: Number(o.delivery_fee),
    total: Number(o.total),
    status: String(o.status),
    email_status: String(o.email_status),
    created_at: String(o.created_at),
    items: byOrder.get(o.id as string) ?? [],
  }))
}

/** Email-only receipt retry — never creates a duplicate order. */
export async function resendConfirmation(orderId: string): Promise<void> {
  const supabase = requireClient()
  const { data, error } = await supabase.functions.invoke('send-order-confirmation', {
    body: { order_id: orderId },
  })
  if (error) {
    const message =
      (typeof data === 'object' && data && (data as { error?: string }).error) ||
      error.message ||
      'Could not resend the receipt'
    throw new BackendError(message, 502)
  }
}
