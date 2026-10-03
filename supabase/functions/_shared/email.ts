// Shared, provider-isolated order confirmation email module.
// The order system depends only on `OrderConfirmationEmail` and
// `sendOrderConfirmation`. Swapping MailerSend for Mailgun means adding a
// `sendWithMailgun` sender here — no changes to order creation logic.
//
// Runtime: Supabase Edge Functions (Deno). No npm dependencies.

export interface OrderLine {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface OrderConfirmationEmail {
  to: string;
  customerName: string;
  orderNumber: string;
  orderId: string;
  items: OrderLine[];
  subtotal: number;
  deliveryFee: number;
  total: number;
}

export type EmailResult =
  | { ok: true; providerId: string }
  | { ok: false; error: string };

export interface EmailSender {
  send(email: OrderConfirmationEmail): Promise<EmailResult>;
}

const naira = (amount: number): string =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(amount);

export function formatOrderSubject(email: OrderConfirmationEmail): string {
  return `Your J-FAS order ${email.orderNumber} is confirmed`;
}

export function formatOrderHtml(email: OrderConfirmationEmail): string {
  const rows = email.items
    .map(
      (line) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #eee;">${escapeHtml(line.name)} &times; ${line.quantity}</td>
          <td align="right" style="padding:10px 0;border-bottom:1px solid #eee;">${naira(line.lineTotal)}</td>
        </tr>`,
    )
    .join("");

  return `
    <div style="font-family:Georgia,serif;color:#29251f;max-width:560px;margin:0 auto;">
      <p style="font-size:12px;letter-spacing:2px;color:#998269;">J-FAS &mdash; THANK YOU${email.customerName ? `, ${escapeHtml(email.customerName)}` : ""}</p>
      <h1 style="font-weight:400;">Order ${escapeHtml(email.orderNumber)} is confirmed.</h1>
      <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      <p>Subtotal: ${naira(email.subtotal)}<br />
      Delivery: ${email.deliveryFee === 0 ? "Complimentary" : naira(email.deliveryFee)}<br />
      <strong>Total: ${naira(email.total)}</strong></p>
      <p style="color:#777;">We are preparing your pieces with care. Reply to this email if anything needs attention.</p>
    </div>`;
}

export function formatOrderText(email: OrderConfirmationEmail): string {
  const lines = email.items
    .map((l) => `- ${l.name} x ${l.quantity}: ${naira(l.lineTotal)}`)
    .join("\n");
  return [
    `J-FAS order ${email.orderNumber} confirmed.`,
    ``,
    lines,
    ``,
    `Subtotal: ${naira(email.subtotal)}`,
    `Delivery: ${email.deliveryFee === 0 ? "Complimentary" : naira(email.deliveryFee)}`,
    `Total: ${naira(email.total)}`,
    ``,
    `Thank you for shopping with J-FAS.`,
  ].join("\n");
}

/** Production sender: MailerSend transactional API (server-side key only). */
export function mailerSendSender(): EmailSender {
  return {
    async send(email: OrderConfirmationEmail): Promise<EmailResult> {
      const apiKey = Deno.env.get("MAILERSEND_API_KEY") ?? "";
      const fromEmail =
        Deno.env.get("MAILERSEND_FROM_EMAIL") ?? "orders@jfas.ng";
      const fromName = Deno.env.get("MAILERSEND_FROM_NAME") ?? "J-FAS";
      const templateId = Deno.env.get("MAILERSEND_TEMPLATE_ID") ?? "";

      if (!apiKey) return { ok: false, error: "MAILERSEND_API_KEY missing" };
      if (!email.to) return { ok: false, error: "Missing recipient email" };

      const body: Record<string, unknown> = templateId
        ? {
            from: { email: fromEmail, name: fromName },
            to: [{ email: email.to }],
            template_id: templateId,
            variables: [
              {
                email: email.to,
                substitutions: [
                  { var: "order_number", value: email.orderNumber },
                  { var: "customer_name", value: email.customerName },
                  { var: "order_total", value: naira(email.total) },
                  { var: "order_body", value: formatOrderText(email) },
                ],
              },
            ],
          }
        : {
            from: { email: fromEmail, name: fromName },
            to: [{ email: email.to }],
            subject: formatOrderSubject(email),
            html: formatOrderHtml(email),
            text: formatOrderText(email),
          };

      try {
        const res = await fetch("https://api.mailersend.com/v1/email", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const detail = (await res.text()).slice(0, 500);
          return { ok: false, error: `MailerSend ${res.status}: ${detail}` };
        }
        return {
          ok: true,
          providerId: res.headers.get("x-message-id") ?? "sent",
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Email send failed",
        };
      }
    },
  };
}

/**
 * Drop-in replacement stub for the provider named in the HNG guide.
 * Implement with the Mailgun Messages API when needed; the order flow
 * stays unchanged because it only calls `sendOrderConfirmation`.
 */
export function mailgunSender(): EmailSender {
  return {
    async send(): Promise<EmailResult> {
      return { ok: false, error: "Mailgun sender not configured" };
    },
  };
}

/** Single entry point used by order functions. */
export async function sendOrderConfirmation(
  email: OrderConfirmationEmail,
  sender: EmailSender = mailerSendSender(),
): Promise<EmailResult> {
  return sender.send(email);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
