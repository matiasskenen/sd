const express = require('express');
const router = express.Router();

function sendError(res, code, message, err) {
  if (err) console.error(`[payments] ${message}`, err);
  else console.error(`[payments] ${message}`);
  return res.status(code).json({ message, error: err?.message || null });
}

module.exports = ({ supabaseAdmin, preference }) => {
  // POST /create-payment-preference
  router.post('/create-payment-preference', async (req, res) => {
    const { cart, customerEmail } = req.body;
    console.log('[payments] POST /create-payment-preference payload:', { customerEmail, cartLength: Array.isArray(cart) ? cart.length : 0 });

    if (!cart?.length || !customerEmail) return sendError(res, 400, 'El carrito está vacío o falta el email.');

    let totalAmount = 0;
    for (const item of cart) totalAmount += Number(item.price) * Number(item.quantity || 1);

    try {
      const { data: orderData, error: orderErr } = await supabaseAdmin.from('orders').insert({ customer_email: customerEmail, total_amount: totalAmount, status: 'pending' }).select().single();
      if (orderErr) return sendError(res, 500, `Error al crear pedido: ${orderErr.message}`, orderErr);

      const items = cart.map((i) => ({ order_id: orderData.id, photo_id: i.photoId, price_at_purchase: Number(i.price), quantity: Number(i.quantity || 1) }));
      const { error: itemsErr } = await supabaseAdmin.from('order_items').insert(items);
      if (itemsErr) return sendError(res, 500, `Error al insertar ítems: ${itemsErr.message}`, itemsErr);

      const prefBody = {
        items: [{ title: 'Compra de Fotos Escolares', unit_price: Number(totalAmount), quantity: 1, currency_id: 'ARS' }],
        external_reference: orderData.id,
        auto_return: 'approved',
        back_urls: {
          success: `${process.env.FRONTEND_URL}/success.html?orderId=${orderData.id}&customerEmail=${encodeURIComponent(customerEmail)}`,
          failure: `${process.env.FRONTEND_URL}/success.html?orderId=${orderData.id}&customerEmail=${encodeURIComponent(customerEmail)}`,
          pending: `${process.env.FRONTEND_URL}/success.html?orderId=${orderData.id}&customerEmail=${encodeURIComponent(customerEmail)}`,
        },
        notification_url: `${process.env.BACKEND_URL}/mercadopago-webhook`,
      };

      console.log('[payments] Creating preference for order:', orderData.id);
      const prefRes = await preference.create({ body: prefBody });
      const initPoint = process.env.NODE_ENV === 'production' ? prefRes.init_point : prefRes.sandbox_init_point;

      return res.status(200).json({ message: 'Preferencia creada', init_point: initPoint, preference_id: prefRes.id, orderId: orderData.id });
    } catch (e) {
      return sendError(res, 500, 'Error interno al crear preferencia.', e);
    }
  });

  // webhook
  router.post('/mercadopago-webhook', express.json(), async (req, res) => {
    console.log('[payments] POST /mercadopago-webhook received. query:', req.query);
    try {
      const { topic, id, resource } = req.query;
      console.log('[payments] webhook topic:', topic);

      let merchantOrderId = null;

      // payment topic
      if (topic === 'payment' || req.body.type === 'payment') {
        const paymentId = id || req.body.data?.id || req.body.resource;
        console.log('[payments] webhook payment id:', paymentId);
        const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
          headers: { Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` },
        });
        const paymentData = await mpRes.json();
        console.log('[payments] payment data status:', paymentData?.status);
        if (paymentData.status === 'approved') merchantOrderId = paymentData.order?.id || paymentData.order_id;
      }

      // merchant_order topic
      if (topic === 'merchant_order' || req.body.topic === 'merchant_order') {
        merchantOrderId = id || resource?.split('/').pop();
        console.log('[payments] webhook merchant_order id:', merchantOrderId);
        const orderRes = await fetch(`https://api.mercadopago.com/merchant_orders/${merchantOrderId}`, { headers: { Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` } });
        const orderData = await orderRes.json();

        console.log('[payments] merchant_order status:', orderData?.order_status, 'paid_amount:', orderData?.paid_amount, 'total_amount:', orderData?.total_amount);

        if (orderData.order_status === 'paid' || orderData.paid_amount >= orderData.total_amount) {
          const orderId = orderData.external_reference;
          console.log('[payments] Marking order paid:', orderId);

          const { data: order, error: orderError } = await supabaseAdmin.from('orders').select('customer_email').eq('id', orderId).single();
          if (orderError || !order) return sendError(res, 500, 'Error obteniendo orden en webhook.', orderError);

          const { data: orderItems, error: itemsError } = await supabaseAdmin.from('order_items').select('photo_id').eq('order_id', orderId);
          if (itemsError || !orderItems.length) return sendError(res, 500, 'Error obteniendo order_items en webhook.', itemsError);

          const photoIds = orderItems.map((item) => item.photo_id);
          const { data: photos, error: photosError } = await supabaseAdmin.from('photos').select('original_file_path').in('id', photoIds);
          if (photosError || !photos.length) return sendError(res, 500, 'Error obteniendo fotos en webhook.', photosError);

          for (const photo of photos) {
            try {
              const { data: signedData, error: signedError } = await supabaseAdmin.storage.from('fotos-originales').createSignedUrl(photo.original_file_path, 60 * 60 * 24 * 7);
              if (signedError) console.warn('[payments] warning creating signed url for', photo.original_file_path, signedError.message);
            } catch (err) {
              console.error('[payments] error creating signed url for photo:', err);
            }
          }

          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          await supabaseAdmin.from('orders').update({ status: 'paid', mercado_pago_payment_id: orderData.payments?.[0]?.id || null, download_expires_at: expiresAt.toISOString() }).eq('id', orderId);

          await supabaseAdmin.from('descargas').insert({ order_id: orderId, user_email: order.customer_email, contador: 0 });

          console.log(`[payments] Orden ${orderId} actualizada a 'paid'`);
        }
      }

      res.sendStatus(200);
    } catch (error) {
      console.error('[payments] ❌ Error en webhook:', error);
      // For webhooks we still return 200 if it's a known recoverable state, but here return 500 so caller sees failure
      res.sendStatus(500);
    }
  });

  return router;
};
