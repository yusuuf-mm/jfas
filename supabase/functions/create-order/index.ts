// POST /functions/v1/create-order
// The authenticated RPC owns checkout state: it validates products and stock,
// calculates trusted totals, writes the order and lines, and decrements stock
// in a single database transaction. This function only authenticates, invokes
// that transaction, and sends a receipt after it succeeds.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type OrderConfirmationEmail,
  sendOrderConfirmation,
} from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CheckoutItem {
  product_id: string;
  quantity: number;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Checkout is not configured" }, 500);

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return json({ error: "Sign in with Google to place an order" }, 401);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const items = normalizeItems(payload["items"]);
  if (!items) return json({ error: "Cart is empty or invalid" }, 400);
  const contact = {
    email: str(payload["email"]) || user.email || "",
    fullName: str(payload["full_name"]),
    phone: str(payload["phone"]),
    address: str(payload["address"]),
    city: str(payload["city"]),
    state: str(payload["state"]),
  };

  // Runs as the caller, so auth.uid() in the SECURITY DEFINER RPC identifies
  // the customer. The RPC transaction is authoritative for prices and totals.
  const { data: created, error: createError } = await authClient.rpc("create_order", {
    p_items: items,
    p_email: contact.email,
    p_full_name: contact.fullName,
    p_phone: contact.phone,
    p_address: contact.address,
    p_city: contact.city,
    p_state: contact.state,
  });
  if (createError || !created) {
    console.error("atomic checkout failed", createError);
    return json({ error: checkoutError(createError?.message) }, 400);
  }

  const order = created as {
    id: string;
    order_number: string;
    subtotal: number;
    delivery_fee: number;
    total: number;
  };
  const admin = createClient(supabaseUrl, serviceKey);
  // Authoritative row for the receipt and response (real created_at included).
  const { data: orderRow } = await admin
    .from("orders")
    .select("id,order_number,subtotal,delivery_fee,total,status,created_at")
    .eq("id", order.id)
    .single();
  const stored = {
    id: String((orderRow?.id ?? order.id) as string),
    order_number: String((orderRow?.order_number ?? order.order_number) as string),
    subtotal: Number((orderRow?.subtotal ?? order.subtotal) as number),
    delivery_fee: Number((orderRow?.delivery_fee ?? order.delivery_fee) as number),
    total: Number((orderRow?.total ?? order.total) as number),
    status: String((orderRow?.status ?? "confirmed") as string),
    created_at: String(
      (orderRow?.created_at ?? new Date().toISOString()) as string,
    ),
  };
  const { data: storedItems, error: itemsError } = await admin
    .from("order_items")
    .select("product_id,quantity,unit_price,line_total,products(name)")
    .eq("order_id", order.id);
  if (itemsError) {
    console.error("receipt item lookup failed", itemsError);
  }

  let emailStatus = "sent";
  let emailWarning: string | undefined;
  if (contact.email) {
    const confirmation: OrderConfirmationEmail = {
      to: contact.email,
      customerName: contact.fullName,
      orderNumber: stored.order_number,
      orderId: stored.id,
      items: (storedItems ?? []).map((row) => {
        const named = row as typeof row & { products?: { name?: string } | null };
        return {
          name: named.products?.name ?? "J-FAS piece",
          quantity: row.quantity as number,
          unitPrice: row.unit_price as number,
          lineTotal: row.line_total as number,
        };
      }),
      subtotal: stored.subtotal,
      deliveryFee: stored.delivery_fee,
      total: stored.total,
    };
    const sent = await sendOrderConfirmation(confirmation);
    if (!sent.ok) {
      emailStatus = "failed";
      emailWarning = sent.error;
      console.error("confirmation email failed", sent.error);
    }
  } else {
    emailStatus = "skipped";
  }
  await admin.from("orders").update({ email_status: emailStatus }).eq("id", order.id);

  return json({
    order: { ...stored, email_status: emailStatus },
    items: (storedItems ?? []).map((row) => {
      const named = row as typeof row & { products?: { name?: string } | null };
      return {
        product_id: String(row.product_id),
        name: named.products?.name ?? "J-FAS piece",
        quantity: Number(row.quantity),
        unit_price: Number(row.unit_price),
        line_total: Number(row.line_total),
      };
    }),
    ...(emailWarning ? { email_warning: emailWarning } : {}),
  }, 201);
});

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

function normalizeItems(value: unknown): CheckoutItem[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) return null;
  const items: CheckoutItem[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const record = raw as Record<string, unknown>;
    const productId = typeof record["product_id"] === "string" ? record["product_id"].trim() : "";
    const quantity = typeof record["quantity"] === "number"
      ? Math.floor(record["quantity"])
      : Number.parseInt(String(record["quantity"] ?? ""), 10);
    if (!productId || !Number.isInteger(quantity) || seen.has(productId)) return null;
    seen.add(productId);
    items.push({ product_id: productId, quantity });
  }
  return items;
}

function checkoutError(message?: string): string {
  if (message?.includes("INSUFFICIENT_STOCK")) return "Insufficient stock for one of the selected pieces";
  if (message?.includes("INVALID_PRODUCT")) return "Unknown product or unavailable piece in your bag";
  if (message?.includes("INVALID_QUANTITY") || message?.includes("DUPLICATE_PRODUCT")) return "One of the quantities is invalid";
  return "Could not save your order, try again";
}
