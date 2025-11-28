/**
 * Rutas para manejo de suscripciones con Mercado Pago
 */

const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");
const { requireAuth } = require("../middleware/auth");

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Inicializar Mercado Pago
const { MercadoPagoConfig, PreApproval, Payment } = require("mercadopago");
const client = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN });
const preapproval = new PreApproval(client);
const payment = new Payment(client);

/**
 * POST /subscriptions/create
 * Crear una suscripción en Mercado Pago
 */
router.post("/create", requireAuth, async (req, res) => {
    try {
        const { planType, paymentMethodId } = req.body; // 'pro' o 'premium'
        const photographer = req.photographer;

        // Validar plan
        if (!["pro", "premium"].includes(planType)) {
            return res.status(400).json({ error: "Plan inválido" });
        }

        // Verificar si ya tiene una suscripción activa Y NO CANCELADA
        const { data: existingSubscription } = await supabaseAdmin
            .from("subscriptions")
            .select("*")
            .eq("photographer_id", photographer.id)
            .in("status", ["active", "pending"])
            .is("cancelled_at", null) // Solo bloquear si NO está cancelada
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

        if (existingSubscription) {
            return res.status(400).json({ 
                error: "Ya tienes una suscripción activa. Cancélala primero para cambiar de plan." 
            });
        }

        // Si tiene una suscripción cancelada, marcarla como "expired" antes de crear nueva
        const { data: cancelledSub } = await supabaseAdmin
            .from("subscriptions")
            .select("*")
            .eq("photographer_id", photographer.id)
            .eq("status", "active")
            .not("cancelled_at", "is", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

        if (cancelledSub) {
            console.log(`🔄 Finalizando suscripción cancelada ID ${cancelledSub.id} antes de crear nueva`);
            await supabaseAdmin
                .from("subscriptions")
                .update({ status: "expired" })
                .eq("id", cancelledSub.id);
        }

        // Obtener detalles del plan desde la BD
        const { data: plan, error: planError } = await supabaseAdmin
            .from("plans")
            .select("*")
            .eq("name", planType)
            .single();

        if (planError || !plan) {
            return res.status(404).json({ error: "Plan no encontrado" });
        }

        // MODO SIMULACIÓN: Simular suscripción sin llamar a MP
        let preapprovalResponse;
        const simulateMP = process.env.SIMULATE_MERCADOPAGO === 'true';
        
        if (simulateMP) {
            // Simular respuesta de Mercado Pago (para testing sin credenciales)
            console.log('🧪 SIMULACIÓN: Creando suscripción sin Mercado Pago');
            const localUrl = 'http://localhost:3000';
            preapprovalResponse = {
                id: `dev_preapproval_${Date.now()}`,
                init_point: `${localUrl}/admin/subscription.html?subscription=success`,
                status: 'authorized'
            };
        } else {
            // Crear preapproval real en Mercado Pago
            // Mercado Pago requiere URL pública válida (no localhost)
            const backUrl = process.env.FRONTEND_URL || 'https://school-photos-backend.onrender.com';
            
            const preapprovalData = {
                reason: `Suscripción ${plan.display_name} - ${photographer.business_name}`,
                auto_recurring: {
                    frequency: 1,
                    frequency_type: "months",
                    transaction_amount: plan.price_cents / 100,
                    currency_id: "ARS",
                },
                back_url: `${backUrl}/admin/subscription.html?subscription=success`,
                payer_email: photographer.email,
                external_reference: photographer.id,
                status: "pending",
            };

            if (paymentMethodId) {
                preapprovalData.card_token_id = paymentMethodId;
            }

            console.log('📤 Enviando a Mercado Pago:', JSON.stringify(preapprovalData, null, 2));
            preapprovalResponse = await preapproval.create({ body: preapprovalData });
            console.log('✅ Respuesta de MP:', preapprovalResponse);
        }

        // Guardar la suscripción pendiente en la BD
        const now = new Date();
        const nextBillingDate = new Date(now);
        nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

        const subscriptionStatus = simulateMP ? 'active' : 'pending';
        
        const { data: subscription, error: subError } = await supabaseAdmin
            .from("subscriptions")
            .insert({
                photographer_id: photographer.id,
                plan_id: plan.id,
                mercadopago_preapproval_id: preapprovalResponse.id,
                status: subscriptionStatus,
                started_at: now.toISOString(),
                current_period_start: now.toISOString(),
                current_period_end: nextBillingDate.toISOString(),
                amount_cents: plan.price_cents,
                currency: "ARS",
                billing_period: "monthly",
            })
            .select()
            .single();

        if (subError) {
            console.error("Error guardando suscripción:", subError);
            return res.status(500).json({ error: "Error al guardar suscripción" });
        }

        // En simulación, activar inmediatamente
        if (simulateMP) {
            await supabaseAdmin
                .from("photographers")
                .update({
                    plan_type: planType,
                    subscription_status: "active",
                    subscription_expires_at: nextBillingDate.toISOString(),
                })
                .eq("id", photographer.id);
            
            console.log(`✅ Suscripción ${planType} activada para ${photographer.email}`);
        }

        res.status(200).json({
            message: "Suscripción creada",
            subscription,
            init_point: preapprovalResponse.init_point, // URL para completar el pago
            preapproval_id: preapprovalResponse.id,
        });
    } catch (error) {
        console.error("Error creando suscripción:", error);
        res.status(500).json({
            error: "Error al crear suscripción",
            details: error.message,
        });
    }
});

/**
 * POST /subscriptions/cancel
 * Cancelar suscripción activa
 */
router.post("/cancel", requireAuth, async (req, res) => {
    try {
        const photographer = req.photographer;

        // Obtener suscripción activa
        const { data: subscription, error: subError } = await supabaseAdmin
            .from("subscriptions")
            .select("*")
            .eq("photographer_id", photographer.id)
            .eq("status", "active")
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

        if (subError || !subscription) {
            return res.status(404).json({ error: "No se encontró suscripción activa" });
        }

        // Cancelar en Mercado Pago (solo si el ID no es simulado)
        const isSimulatedId = subscription.mercadopago_preapproval_id.startsWith('dev_preapproval_');
        if (!isSimulatedId && process.env.SIMULATE_MERCADOPAGO !== 'true') {
            await preapproval.update({
                id: subscription.mercadopago_preapproval_id,
                body: { status: "cancelled" },
            });
        } else {
            console.log('🧪 SIMULACIÓN: Cancelación sin llamar a Mercado Pago (ID simulado o modo simulación activo)');
        }

        // Actualizar en la BD
        await supabaseAdmin
            .from("subscriptions")
            .update({
                status: "cancelled",
                cancelled_at: new Date().toISOString(),
                cancel_at_period_end: true, // Sigue activo hasta fin del período
            })
            .eq("id", subscription.id);

        // NO actualizar photographer.subscription_status aún
        // Se actualizará cuando llegue a current_period_end

        res.status(200).json({
            message: "Suscripción cancelada. Seguirás teniendo acceso hasta el fin del período de facturación.",
            subscription,
            access_until: subscription.current_period_end,
        });
    } catch (error) {
        console.error("Error cancelando suscripción:", error);
        res.status(500).json({ error: "Error al cancelar suscripción" });
    }
});

/**
 * GET /subscriptions/status
 * Obtener estado de la suscripción del fotógrafo
 */
router.get("/status", requireAuth, async (req, res) => {
    try {
        const photographer = req.photographer;

        // Obtener suscripción actual
        const { data: subscription, error: subError } = await supabaseAdmin
            .from("subscriptions")
            .select("*, plans(*)")
            .eq("photographer_id", photographer.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

        if (subError || !subscription) {
            return res.status(200).json({
                hasSubscription: false,
                photographer: {
                    subscription_status: photographer.subscription_status,
                    trial_ends_at: photographer.trial_ends_at,
                },
            });
        }

        // Obtener historial de pagos
        const { data: payments } = await supabaseAdmin
            .from("subscription_payments")
            .select("*")
            .eq("subscription_id", subscription.id)
            .order("created_at", { ascending: false });

        res.status(200).json({
            hasSubscription: true,
            subscription,
            payments: payments || [],
            photographer: {
                subscription_status: photographer.subscription_status,
                trial_ends_at: photographer.trial_ends_at,
                subscription_expires_at: photographer.subscription_expires_at,
            },
        });
    } catch (error) {
        console.error("Error obteniendo estado de suscripción:", error);
        res.status(500).json({ error: "Error al obtener estado" });
    }
});

/**
 * POST /subscriptions/webhook
 * Webhook de Mercado Pago para notificaciones de suscripciones
 */
router.post("/webhook", async (req, res) => {
    try {
        const { type, data } = req.body;

        console.log("📩 Webhook de suscripción recibido:", { type, data });

        // Responder inmediatamente para que MP no reintente
        res.status(200).send("OK");

        // Procesar según el tipo de notificación
        if (type === "preapproval") {
            // Obtener detalles de la suscripción desde MP
            const preapprovalId = data.id;
            const preapprovalResponse = await preapproval.get({ id: preapprovalId });
            const preapprovalData = preapprovalResponse;

            console.log("📋 Detalles de preapproval:", preapprovalData);

            // Buscar la suscripción en nuestra BD
            const { data: subscription } = await supabaseAdmin
                .from("subscriptions")
                .select("*")
                .eq("mercadopago_preapproval_id", preapprovalId)
                .single();

            if (!subscription) {
                console.error("❌ Suscripción no encontrada:", preapprovalId);
                return;
            }

            // Actualizar según el estado
            const status = preapprovalData.status;
            const updates = {};

            if (status === "authorized") {
                updates.status = "active";
                updates.mercadopago_payer_id = preapprovalData.payer_id;

                // Actualizar estado del fotógrafo
                await supabaseAdmin
                    .from("photographers")
                    .update({
                        subscription_status: "active",
                        subscription_expires_at: preapprovalData.next_payment_date || null,
                    })
                    .eq("id", subscription.photographer_id);
            } else if (status === "cancelled") {
                updates.status = "cancelled";

                // Actualizar fotógrafo
                await supabaseAdmin
                    .from("photographers")
                    .update({ subscription_status: "cancelled" })
                    .eq("id", subscription.photographer_id);
            } else if (status === "paused") {
                updates.status = "paused";
            }

            // Actualizar suscripción
            await supabaseAdmin.from("subscriptions").update(updates).eq("id", subscription.id);

            console.log("✅ Suscripción actualizada:", updates);
        } else if (type === "payment") {
            // Pago mensual recurrente
            const paymentId = data.id;
            const paymentResponse = await payment.get({ id: paymentId });
            const paymentData = paymentResponse;

            console.log("💳 Pago recibido:", paymentData);

            // Buscar suscripción por external_reference (photographer_id)
            const { data: subscription } = await supabaseAdmin
                .from("subscriptions")
                .select("*")
                .eq("mercadopago_payer_id", paymentData.payer.id)
                .eq("status", "active")
                .single();

            if (!subscription) {
                console.error("❌ No se encontró suscripción para el pago:", paymentId);
                return;
            }

            // Registrar el pago
            const now = new Date();
            const nextPeriodEnd = new Date(now);
            nextPeriodEnd.setMonth(nextPeriodEnd.getMonth() + 1);

            await supabaseAdmin.from("subscription_payments").insert({
                subscription_id: subscription.id,
                photographer_id: subscription.photographer_id,
                plan_id: subscription.plan_id,
                mercadopago_payment_id: paymentId,
                amount_cents: paymentData.transaction_amount * 100,
                currency: paymentData.currency_id,
                status: paymentData.status === "approved" ? "approved" : "rejected",
                period_start: subscription.current_period_start,
                period_end: subscription.current_period_end,
                paid_at: paymentData.status === "approved" ? now.toISOString() : null,
                payment_method: paymentData.payment_method_id,
            });

            if (paymentData.status === "approved") {
                // Extender suscripción
                await supabaseAdmin
                    .from("subscriptions")
                    .update({
                        current_period_start: now.toISOString(),
                        current_period_end: nextPeriodEnd.toISOString(),
                    })
                    .eq("id", subscription.id);

                await supabaseAdmin
                    .from("photographers")
                    .update({
                        subscription_status: "active",
                        subscription_expires_at: nextPeriodEnd.toISOString(),
                    })
                    .eq("id", subscription.photographer_id);

                console.log("✅ Pago aprobado, suscripción renovada");
            } else if (paymentData.status === "rejected") {
                // Marcar como vencida
                await supabaseAdmin
                    .from("photographers")
                    .update({ subscription_status: "past_due" })
                    .eq("id", subscription.photographer_id);

                console.log("⚠️ Pago rechazado, cuenta marcada como past_due");
            }
        }
    } catch (error) {
        console.error("❌ Error procesando webhook de suscripción:", error);
    }
});

module.exports = router;
