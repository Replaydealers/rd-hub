// Tsumiki V1.0 – Zahlungsanbindung
// Prinzip: Betrag beim Bestellen nur VORMERKEN, erst nach erfolgreichem Kauf in Japan ABBUCHEN.
//  - PayPal: Orders API mit intent=AUTHORIZE → später capture/void
//  - Stripe: Checkout mit capture_method=manual (Karte, Apple Pay, Google Pay, Klarna) → später capture/cancel
//  - Ohne Schlüssel in der .env läuft automatisch der Demo-Modus (simulierte Zahlung).

const env = (k) => process.env[k] || '';

export function paymentModes() {
  return {
    paypal: env('PAYPAL_CLIENT_ID') && env('PAYPAL_SECRET') ? 'live-oder-sandbox' : 'demo',
    stripe: env('STRIPE_SECRET_KEY') ? 'live-oder-test' : 'demo',
    ueberweisung: 'manuell',
  };
}

// ---------- PayPal ----------
const paypalBase = () => (env('PAYPAL_ENV') === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');
async function paypalToken() {
  const r = await fetch(paypalBase() + '/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(env('PAYPAL_CLIENT_ID') + ':' + env('PAYPAL_SECRET')).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('PayPal-Anmeldung fehlgeschlagen');
  return j.access_token;
}
async function paypalCall(path, body) {
  const t = await paypalToken();
  const r = await fetch(paypalBase() + path, { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('PayPal: ' + (j.message || r.status));
  return j;
}

// ---------- Stripe ----------
async function stripeCall(path, params, method = 'POST') {
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const r = await fetch('https://api.stripe.com/v1' + path, { method, headers: { Authorization: 'Bearer ' + env('STRIPE_SECRET_KEY'), 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json();
  if (!r.ok) throw new Error('Stripe: ' + (j.error && j.error.message));
  return j;
}

export function createPayments(baseUrl) {
  const modes = paymentModes();
  return {
    modes,
    // Startet die Zahlung → URL, auf die der Kunde weitergeleitet wird
    async start(order) {
      const cents = Math.round(order.gross * 100);
      if (order.paymentMethod === 'ueberweisung') return `/status.html?b=${order.token}&neu=1`;
      if (order.paymentMethod === 'paypal' && modes.paypal !== 'demo') {
        const j = await paypalCall('/v2/checkout/orders', {
          intent: 'AUTHORIZE',
          purchase_units: [{ reference_id: order.id, description: `Bestellung ${order.id}`, amount: { currency_code: 'EUR', value: (cents / 100).toFixed(2) } }],
          application_context: { brand_name: 'Tsumiki', user_action: 'CONTINUE', return_url: `${baseUrl}/api/pay/paypal/return?b=${order.token}`, cancel_url: `${baseUrl}/api/pay/cancel?b=${order.token}` },
        });
        return j.links.find((l) => l.rel === 'approve').href;
      }
      if (order.paymentMethod === 'stripe' && modes.stripe !== 'demo') {
        const s = await stripeCall('/checkout/sessions', {
          mode: 'payment', 'payment_intent_data[capture_method]': 'manual',
          'line_items[0][price_data][currency]': 'eur', 'line_items[0][price_data][unit_amount]': String(cents),
          'line_items[0][price_data][product_data][name]': `Bestellung ${order.id}`, 'line_items[0][quantity]': '1',
          customer_email: order.email, success_url: `${baseUrl}/api/pay/stripe/return?b=${order.token}&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${baseUrl}/api/pay/cancel?b=${order.token}`,
        });
        return s.url;
      }
      return `/bezahlen.html?b=${order.token}&m=${order.paymentMethod}`; // Demo
    },
    async confirmPaypal(paypalOrderId) {
      const j = await paypalCall(`/v2/checkout/orders/${paypalOrderId}/authorize`);
      const a = j.purchase_units[0].payments.authorizations[0];
      return { ref: a.id, amount: Number(a.amount.value) };
    },
    async confirmStripe(sessionId) {
      const s = await stripeCall(`/checkout/sessions/${sessionId}`, null, 'GET');
      const pi = await stripeCall(`/payment_intents/${s.payment_intent}`, null, 'GET');
      if (pi.status !== 'requires_capture') throw new Error('Stripe: Zahlung nicht reserviert (' + pi.status + ')');
      return { ref: pi.id, amount: pi.amount_capturable / 100 };
    },
    // Wird vom Rechenkern aufgerufen, sobald in Japan gekauft wurde
    async capture(order, amount) {
      if (String(order.paymentRef).startsWith('DEMO')) return { ok: true };
      if (order.paymentMethod === 'paypal' && modes.paypal !== 'demo') {
        await paypalCall(`/v2/payments/authorizations/${order.paymentRef}/capture`, { amount: { currency_code: 'EUR', value: amount.toFixed(2) }, final_capture: true });
      } else if (order.paymentMethod === 'stripe' && modes.stripe !== 'demo') {
        await stripeCall(`/payment_intents/${order.paymentRef}/capture`, { amount_to_capture: String(Math.round(amount * 100)) });
      }
      return { ok: true };
    },
    async void(order) {
      if (String(order.paymentRef).startsWith('DEMO')) return { ok: true };
      if (order.paymentMethod === 'paypal' && modes.paypal !== 'demo') await paypalCall(`/v2/payments/authorizations/${order.paymentRef}/void`);
      else if (order.paymentMethod === 'stripe' && modes.stripe !== 'demo') await stripeCall(`/payment_intents/${order.paymentRef}/cancel`, {});
      return { ok: true };
    },
    async refund(order, amount) {
      // Erstattung nach Widerruf: im Demo-Modus nur protokolliert.
      // Echt: PayPal /v2/payments/captures/{id}/refund bzw. Stripe /v1/refunds – Capture-ID dafür speichern (TODO V1.1).
      return { ok: true, manual: true, amount };
    },
  };
}
