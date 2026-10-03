// POST /functions/v1/send-order-confirmation
// Email-only retry for an existing order owned by the caller. Used when
// create-order returns email_status "failed" so the client never creates a
// duplicate order just to resend the receipt.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendOrderConfirmation } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: "Email service is not configured" }, 500);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return json({ error: "Sign in to resend receipts" }, 401);

  let orderId = "";
  try {
    orderId = String((await req.json())?.order_id ?? "");
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (!orderId) return json({ error: "order_id is required" }, 400);

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id,order_number,user_id,email,subtotal,delivery_fee,total")
    .eq("id", orderId)
    .single();
  if (orderError || !order || order.user_id !== user.id) {
    return json({ error: "Order not found" }, 404);
  }
  if (!order.email) return json({ error: "Order has no email address" }, 400);

  const { data: items } = await admin
    .from("order_items")
    .select("quantity,unit_price,line_total,products(name)")
    .eq("order_id", orderId);

  const sent = await sendOrderConfirmation({
    to: order.email as string,
    customerName: "",
    orderNumber: order.order_number as string,
    orderId: order.id as string,
    items: (items ?? []).map((row) => {
      const named = row as typeof row & { products?: { name?: string } | null };
      return {
        name: named.products?.name ?? "J-FAS piece",
        quantity: row.quantity as number,
        unitPrice: row.unit_price as number,
        lineTotal: row.line_total as number,
      };
    }),
    subtotal: order.subtotal as number,
    deliveryFee: order.delivery_fee as number,
    total: order.total as number,
  });

  if (!sent.ok) return json({ error: sent.error }, 502);
  await admin
    .from("orders")
    .update({ email_status: "sent" })
    .eq("id", orderId);
  return json({ ok: true, email_status: "sent" }, 200);
});

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
