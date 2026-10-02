export interface Product {
  id: string
  name: string
  category: 'Jewelry' | 'Bags' | 'Accessories'
  price: number
  image: string
  description: string
  badge?: string
  color: string
}

// Replace this local catalog with a Supabase-backed ProductRepository when connected.
export const products: Product[] = [
  { id: 'sol-chain', name: 'Sol Chain Necklace', category: 'Jewelry', price: 28500, image: 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=900&q=85', description: 'A delicate gold-plated chain with a softly sculpted pendant. Made for everyday, kept forever.', badge: 'Bestseller', color: 'Gold' },
  { id: 'arc-earrings', name: 'Arc Stud Earrings', category: 'Jewelry', price: 18500, image: 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=900&q=85', description: 'An organic silhouette with a subtle, polished glow. Your new everyday signature.', color: 'Gold' },
  { id: 'muse-bag', name: 'Muse Mini Bag', category: 'Bags', price: 42000, image: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=900&q=85', description: 'A sculptural little companion in supple leather-look finish, sized for the essentials.', badge: 'New', color: 'Chocolate' },
  { id: 'pearl-drop', name: 'Pearl Drop Necklace', category: 'Jewelry', price: 32000, image: 'https://images.unsplash.com/photo-1611085583191-a3b181a88401?auto=format&fit=crop&w=900&q=85', description: 'Freshwater-inspired pearls meet a fine, luminous chain for a modern heirloom.', color: 'Pearl' },
  { id: 'luna-cuff', name: 'Luna Cuff', category: 'Accessories', price: 24000, image: 'https://images.unsplash.com/photo-1611591437281-460bfbe1220a?auto=format&fit=crop&w=900&q=85', description: 'A clean, open cuff with a gentle curve. Beautiful worn alone or layered.', color: 'Gold' },
  { id: 'woven-tote', name: 'Sunday Woven Tote', category: 'Bags', price: 38500, image: 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=85', description: 'Room for the day, shape for the season. Thoughtful texture, easy elegance.', color: 'Natural' },
  { id: 'halo-ring', name: 'Halo Signet Ring', category: 'Jewelry', price: 21500, image: 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=900&q=85', description: 'A softly rounded signet with a light-catching finish. A small piece with presence.', color: 'Gold' },
  { id: 'terra-hoops', name: 'Terra Hoops', category: 'Jewelry', price: 19500, image: 'https://images.unsplash.com/photo-1630019852942-f89202989a59?auto=format&fit=crop&w=900&q=85', description: 'Lightweight sculpted hoops with a satisfyingly smooth, substantial feel.', color: 'Gold' },
]

export const naira = (amount: number) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount)
