import type { CheckoutItem } from './shopApi'

export interface CatalogPrice {
  id: string
  price: number
  stock: number
  active: boolean
}

export const FREE_DELIVERY_THRESHOLD = 50000
export const DELIVERY_FEE = 2500

/**
 * Pure, testable mirror of the server-side checkout rules. The frontend uses
 * this only for previews; the Edge Function / create_order RPC is the
 * authority that re-validates everything against the database.
 */
export function validateCheckoutItems(
  items: CheckoutItem[],
  catalog: CatalogPrice[],
): { subtotal: number; deliveryFee: number; total: number } {
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
