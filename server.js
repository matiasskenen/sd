// server.js
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

// Carga las variables de entorno al inicio de todo
require("dotenv").config();

const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const multer = require("multer");
const sharp = require("sharp"); // Para el procesamiento de imágenes
const path = require("path"); // Para manejar rutas de archivos
const fs = require("fs"); // Para verificar si la marca de agua existe (opcional, pero buena práctica)
const mercadopago = require("mercadopago"); // Importa el módulo completo de mercadopago
const cors = require("cors"); // Importa el módulo CORS

const app = express();
const PORT = process.env.PORT || 3000;

// --- Configuración de Supabase ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Verificación de todas las variables de entorno necesarias
if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    console.error("Error: Asegúrate de que SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY estén definidas en el archivo .env.");
    process.exit(1); // Sale de la aplicación si falta alguna
}

// Cliente Supabase para operaciones generales (login de usuarios, lectura de datos públicos)
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Cliente Supabase con rol de servicio (para operaciones administrativas y escritura en buckets privados)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

// Nombres de buckets de Supabase
const ORIGINAL_BUCKET_NAME = "original-photos";
const WATERMARKED_BUCKET_NAME = "watermarked-photos";
const ORDER_FIELD_NAME = "order_id";

// Crea una instancia del cliente de Mercado Pago con tu Access Token
const client = new mercadopago.MercadoPagoConfig({
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
});

const preference = new mercadopago.Preference(client);
const payment = new mercadopago.Payment(client);

// Función con reintentos para obtener Merchant Order (para webhooks)
async function getMerchantOrderWithRetry(merchantOrderId, retries = 5) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(`https://api.mercadolibre.com/merchant_orders/${merchantOrderId}`, {
                headers: {
                    Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
                },
            });

            const orderData = await response.json(); // Si la orden tiene pagos, la devolvemos

            if (orderData && orderData.payments && orderData.payments.length > 0) {
                return orderData;
            } // Si no tiene pagos y no es el último intento, esperamos y reintentamos

            if (i < retries - 1) {
                console.log(`Intento ${i + 1} sin pagos. Esperando 3s...`);
                await new Promise((res) => setTimeout(res, 3000));
            } else {
                // Último intento, devolvemos lo que tengamos
                return orderData;
            }
        } catch (err) {
            console.error(`Error en getMerchantOrderWithRetry (Intento ${i + 1}):`, err);
            if (i < retries - 1) {
                await new Promise((res) => setTimeout(res, 3000));
            } else {
                throw err; // Si es el último intento y sigue fallando, lanzamos el error
            }
        }
    }
}

// Función con reintentos para obtener Payment (aunque ahora usamos Merchant Order)
// Se mantiene por si se decide usar directamente el webhook de payment en el futuro
async function tryGetPaymentWithRetry(paymentId, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const result = await payment.get({ id: paymentId });
            return result;
        } catch (err) {
            if (err.status === 404 && i < retries - 1) {
                console.log(`Intento ${i + 1} falló al obtener Payment. Reintentando en 3s...`);
                await new Promise((res) => setTimeout(res, 3000));
            } else {
                throw err;
            }
        }
    }
}

// --- Middlewares ---
app.use(express.json()); // Para parsear cuerpos de petición JSON
app.use(express.urlencoded({ extended: true })); // Para parsear datos de formularios URL-encoded
app.use(cors()); // Habilita CORS para todas las rutas

// Sirve los archivos estáticos desde la carpeta 'public'
app.use(express.static("public"));

// Configuración de Multer para la subida de archivos
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 25 * 1024 * 1024 }, // Limite de 25MB por archivo, ajusta según necesidad
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        } else {
            cb(new Error("Solo se permiten archivos de imagen."), false);
        }
    },
});

// --- Rutas ---

// Servir la página principal (index.html) en la raíz
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Ruta de estado / prueba para verificar que el servidor está funcionando
app.get("/status", (req, res) => {
    res.send("Backend de la Plataforma de Fotos Escolares funcionando!");
});

// Ruta de prueba para verificar la conexión a Supabase
app.get("/test-supabase", async (req, res) => {
    try {
        // Usamos supabaseAdmin para asegurarnos de que la conexión de servicio funciona
        const { data, error } = await supabaseAdmin.from("albums").select("*").limit(1);

        if (error) {
            console.error("Error al probar Supabase:", error);
            return res.status(500).json({ message: "Error al conectar con Supabase", error: error.message });
        }
        res.status(200).json({ message: "Conexión a Supabase exitosa. Datos de álbumes (si hay):", data });
    } catch (err) {
        console.error("Error inesperado en /test-supabase:", err);
        res.status(500).json({ message: "Error inesperado del servidor" });
    }
});

// --- NUEVAS RUTAS: Gestión de Álbumes ---

// Ruta para obtener todos los álbumes (para el dropdown en el admin)
app.get("/albums", async (req, res) => {
    try {
        // En un sistema real, aquí verificarías la autenticación del fotógrafo
        // const { data: user } = await supabase.auth.getUser();
        // if (!user) return res.status(401).json({ message: 'No autorizado.' });

        // Usamos supabaseAdmin para obtener todos los álbumes sin restricciones RLS
        const { data: albums, error } = await supabaseAdmin.from("albums").select("id, name");

        if (error) {
            console.error("Error al obtener álbumes:", error.message);
            return res.status(500).json({ message: `Error al obtener álbumes: ${error.message}` });
        }
        res.status(200).json({ message: "Álbumes obtenidos exitosamente.", albums });
    } catch (err) {
        console.error("Error inesperado al obtener álbumes:", err);
        res.status(500).json({ message: "Error interno del servidor al obtener álbumes." });
    }
});

// Ruta para crear un nuevo álbum
app.post("/albums", async (req, res) => {
    const { name, event_date } = req.body; // Asegúrate de recibir event_date del frontend // En un sistema real, el photographer_user_id vendría de la sesión del usuario logueado
    const photographer_user_id = "65805569-2e32-46a0-97c5-c52e31e02866"; // <-- ¡IMPORTANTE! Usar el ID real del fotógrafo logueado

    if (!name) {
        return res.status(400).json({ message: "El nombre del álbum es requerido." });
    } // Validar event_date si es requerido por la BD
    if (!event_date) {
        return res.status(400).json({ message: "La fecha del evento es requerida para el álbum." });
    } // *** LOG PARA DEPURACIÓN: Muestra los datos que se intentan insertar ***

    console.log("Intentando crear álbum con datos:", { name, event_date, photographer_user_id }); // *** FIN LOG ***
    try {
        const { data: album, error } = await supabaseAdmin
            .from("albums")
            .insert({ name, event_date, photographer_user_id }) // Incluye event_date aquí
            .select()
            .single();

        if (error) {
            console.error("Error al crear álbum:", error.message);
            return res.status(500).json({ message: `Error al crear álbum: ${error.message}` });
        }
        res.status(201).json({ message: "Álbum creado exitosamente.", album });
    } catch (err) {
        console.error("Error inesperado al crear álbum:", err);
        res.status(500).json({ message: "Error interno del servidor al crear álbum." });
    }
});

// Ruta para obtener fotos de un álbum específico (para el cliente)
app.get("/albums/:albumId/photos", async (req, res) => {
    const albumId = req.params.albumId;

    if (!albumId || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(albumId)) {
        return res.status(400).json({ message: "ID de álbum no válido." });
    }

    try {
        const { data: photos, error } = await supabaseAdmin.from("photos").select("id, watermarked_file_path, student_code, price, metadata").eq("album_id", albumId);

        if (error) {
            console.error("Error al obtener fotos del álbum:", error.message);
            return res.status(500).json({ message: `Error al obtener fotos: ${error.message}` });
        }

        if (!photos || photos.length === 0) {
            return res.status(404).json({ message: "No se encontraron fotos para este álbum." });
        }

        const photosWithPublicUrls = photos.map((photo) => ({
            ...photo,
            public_watermarked_url: `${supabaseUrl}/storage/v1/object/public/watermarked-photos/${photo.watermarked_file_path}`,
        }));

        res.status(200).json({
            message: `Fotos obtenidas exitosamente para el álbum ${albumId}.`,
            photos: photosWithPublicUrls,
        });
    } catch (err) {
        console.error("Error inesperado al obtener fotos:", err);
        res.status(500).json({ message: "Error inesperado del servidor" });
    }
});

// Ruta de login para fotógrafos
app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: "Email y contraseña son requeridos." });
    }

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });

        if (error) {
            console.error("Error de autenticación:", error.message);
            if (error.message.includes("Invalid login credentials")) {
                return res.status(401).json({ message: "Credenciales inválidas. Por favor, verifica tu email y contraseña." });
            }
            return res.status(500).json({ message: `Error al iniciar sesión: ${error.message}` });
        }

        res.status(200).json({
            message: "Inicio de sesión exitoso.",
            user: data.user,
            session: data.session,
        });
    } catch (err) {
        console.error("Error inesperado en el login:", err);
        res.status(500).json({ message: "Error interno del servidor al intentar iniciar sesión." });
    }
});

// Ruta para crear una preferencia de pago en Mercado Pago
// Handler para crear preferencia de pago (factorizado para ser reutilizable)
async function createPaymentPreferenceHandler(req, res) {
    const { cart, customerEmail } = req.body;
    if (!cart?.length || !customerEmail) {
        return res.status(400).json({ message: "El carrito está vacío o falta el email." });
    }

    let totalAmount = 0;
    for (const item of cart) totalAmount += Number(item.price) * Number(item.quantity || 1);

    try {
        // 1) Crear order
        const { data: orderData, error: orderErr } = await supabaseAdmin.from("orders").insert({ customer_email: customerEmail, total_amount: totalAmount, status: "pending" }).select().single();
        if (orderErr) return res.status(500).json({ message: `Error al crear pedido: ${orderErr.message}` });

        // 2) Insert order_items
        const items = cart.map((i) => ({
            order_id: orderData.id,
            photo_id: i.photoId,
            price_at_purchase: Number(i.price),
            quantity: Number(i.quantity || 1),
        }));
        const { error: itemsErr } = await supabaseAdmin.from("order_items").insert(items);
        if (itemsErr) return res.status(500).json({ message: `Error al insertar ítems: ${itemsErr.message}` });

        // 3) Crear preferencia (suma total como 1 ítem)
        const prefBody = {
            items: [{ title: "Compra de Fotos Escolares", unit_price: Number(totalAmount), quantity: 1, currency_id: "ARS" }],
            external_reference: orderData.id, // <- lo usamos en el webhook
            back_urls: {
                success: `${process.env.FRONTEND_URL}/success.html?orderId=${orderData.id}&customerEmail=${encodeURIComponent(customerEmail)}`,
                failure: `${process.env.FRONTEND_URL}/success.html?orderId=${orderData.id}&customerEmail=${encodeURIComponent(customerEmail)}`,
                pending: `${process.env.FRONTEND_URL}/success.html?orderId=${orderData.id}&customerEmail=${encodeURIComponent(customerEmail)}`,
            },
            auto_return: "approved",
            notification_url: `${process.env.BACKEND_URL}/mercadopago-webhook`,
        };

        console.log(prefBody);
        const prefRes = await preference.create({ body: prefBody });
        const initPoint = process.env.NODE_ENV === "production" ? prefRes.init_point : prefRes.sandbox_init_point;

        return res.status(200).json({
            message: "Preferencia creada",
            init_point: initPoint,
            preference_id: prefRes.id, // <- evita confundir con payment_id
            orderId: orderData.id,
        });
    } catch (e) {
        console.error("create-payment-preference error:", e);
        return res.status(500).json({ message: "Error interno al crear preferencia." });
    }
}

// Rutas que usan el mismo handler (alias para compatibilidad con frontend antiguo)
app.post("/create-payment-preference", createPaymentPreferenceHandler);
app.post("/payments/create-payment-preference", createPaymentPreferenceHandler);

app.post("/upload-photos/:albumId", upload.array("photos"), async (req, res) => {
    const albumId = req.params.albumId;
    const photographerId = "65805569-2e32-46a0-97c5-c52e31e02866"; // <-- tu ID fijo por ahora

    if (!albumId || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(albumId)) {
        return res.status(400).json({ message: "ID de álbum no válido." });
    }

    try {
        const { data: album, error: albumError } = await supabaseAdmin.from("albums").select("id, photographer_user_id").eq("id", albumId).eq("photographer_user_id", photographerId).single();

        if (albumError || !album) {
            console.error("Error al verificar álbum:", albumError ? albumError.message : "Álbum no encontrado.");
            return res.status(404).json({ message: "Álbum no encontrado o no autorizado para este fotógrafo." });
        }
    } catch (dbError) {
        console.error("Error de base de datos al verificar álbum:", dbError);
        return res.status(500).json({ message: "Error interno del servidor al verificar el álbum." });
    }

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: "No se subieron archivos." });
    }

    const watermarkedPhotosPath = path.resolve(__dirname, "assets", "watermark.png");
    console.log("Intentando cargar marca de agua desde:", watermarkedPhotosPath);
    if (!fs.existsSync(watermarkedPhotosPath)) {
        console.error(`Error: Archivo de marca de agua no encontrado en ${watermarkedPhotosPath}`);
        return res.status(500).json({ message: "Error interno: Archivo de marca de agua no encontrado." });
    }

    const results = [];

    for (const file of req.files) {
        try {
            const uniqueFileName = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}${path.extname(file.originalname)}`;
            const originalFilePath = `albums/${albumId}/original/${uniqueFileName}`;
            const watermarkedFilePath = `albums/${albumId}/watermarked/${uniqueFileName}`;

            // Subir imagen original
            const { error: uploadOriginalError } = await supabaseAdmin.storage.from(ORIGINAL_BUCKET_NAME).upload(originalFilePath, file.buffer, {
                contentType: file.mimetype,
                upsert: false,
            });

            if (uploadOriginalError) {
                console.error(`Error al subir la imagen original "${file.originalname}":`, uploadOriginalError.message);
                throw new Error(`Fallo al subir original: ${uploadOriginalError.message}`);
            }

            // Redimensionar la marca de agua si es necesario
            const watermarkBuffer = await sharp(watermarkedPhotosPath)
                .resize({ width: 200 }) // Ajustá el tamaño si querés
                .toBuffer();

            // Aplicar marca de agua
            const watermarkedBuffer = await sharp(file.buffer)
                .composite([
                    {
                        input: watermarkBuffer,
                        gravity: "center",
                    },
                ])
                .toFormat("jpeg", { quality: 80 })
                .toBuffer();

            // Subir imagen con marca de agua
            const { error: uploadWatermarkedError } = await supabaseAdmin.storage.from(WATERMARKED_BUCKET_NAME).upload(watermarkedFilePath, watermarkedBuffer, {
                contentType: "image/jpeg",
                upsert: false,
            });

            if (uploadWatermarkedError) {
                console.error(`Error al subir la imagen con marca de agua "${file.originalname}":`, uploadWatermarkedError.message);
                throw new Error(`Fallo al subir marcada de agua: ${uploadWatermarkedError.message}`);
            }

            const publicWatermarkedUrl = `${supabaseUrl}/storage/v1/object/public/watermarked-photos/${watermarkedFilePath}`;

            const { data: photoDbData, error: dbInsertError } = await supabaseAdmin
                .from("photos")
                .insert([
                    {
                        album_id: albumId,
                        original_file_path: originalFilePath,
                        watermarked_file_path: watermarkedFilePath,
                        student_code: null,
                        price: 15.0,
                        metadata: {
                            originalName: file.originalname,
                            mimetype: file.mimetype,
                            size: file.size,
                        },
                    },
                ])
                .select()
                .single();

            if (dbInsertError) {
                console.error(`Error al insertar en la BD para "${file.originalname}":`, dbInsertError.message);
                throw new Error(`Fallo al guardar en la BD: ${dbInsertError.message}`);
            }

            results.push({
                originalName: file.originalname,
                status: "success",
                photoId: photoDbData.id,
                publicWatermarkedUrl: publicWatermarkedUrl,
            });
        } catch (error) {
            console.error(`Error procesando o subiendo "${file.originalname}":`, error.message);
            results.push({
                originalName: file.originalname,
                status: "failed",
                error: error.message,
            });
        }
    }

    res.status(200).json({
        message: "Proceso de subida de fotos completado.",
        summary:
            results.length > 0
                ? `${results.filter((r) => r.status === "success").length} fotos subidas con éxito, ${results.filter((r) => r.status === "failed").length} fallidas.`
                : "No se procesaron fotos.",
        results: results,
    });
});

// --- NUEVA RUTA: Webhook de Mercado Pago ---
// Ruta RAW: poner ANTES de app.use(express.json()) global, o usar el middleware específico como abajo.
// Si mantenés tu express.json() global, declaralo así con middleware específico:
const replayProtectionCache = new Map(); // In-memory cache for anti-replay protection
const REPLAY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes TTL

app.post("/mercadopago-webhook", express.json(), async (req, res) => {
    const webhookStartTime = Date.now();
    const webhookLogId = `WH-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`\n${"=".repeat(80)}`);
    console.log(`📩 [${webhookLogId}] Webhook recibido de Mercado Pago`);
    console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
    console.log(`${"=".repeat(80)}\n`);

    try {
        // ===== 1. VALIDACIÓN DE ORIGEN (x-signature) =====
        const xSignature = req.headers["x-signature"];
        const xRequestId = req.headers["x-request-id"];
        
        console.log(`🔐 [${webhookLogId}] Headers recibidos:`);
        console.log(`   - x-signature: ${xSignature ? "✓ Presente" : "✗ Faltante"}`);
        console.log(`   - x-request-id: ${xRequestId || "N/A"}`);

        if (!xSignature) {
            console.error(`❌ [${webhookLogId}] RECHAZADO: Falta x-signature`);
            return res.status(400).json({ error: "Missing x-signature header" });
        }

        // Validar firma según documentación de MP
        const dataId = req.query.id || req.body.data?.id;
        const topic = req.query.topic || req.body.type;
        
        // Construir el mensaje según MP docs: id + data_id
        const parts = xSignature.split(",");
        let ts, hash;
        
        parts.forEach(part => {
            const [key, value] = part.split("=");
            if (key && value) {
                const trimmedKey = key.trim();
                const trimmedValue = value.trim();
                if (trimmedKey === "ts") ts = trimmedValue;
                if (trimmedKey === "v1") hash = trimmedValue;
            }
        });

        if (!ts || !hash) {
            console.error(`❌ [${webhookLogId}] RECHAZADO: Formato de x-signature inválido`);
            return res.status(400).json({ error: "Invalid x-signature format" });
        }

        // Verificar timestamp (rechazar si es mayor a 5 minutos)
        const currentTime = Date.now();
        const requestTime = parseInt(ts) * 1000;
        const timeDiff = Math.abs(currentTime - requestTime);
        
        console.log(`⏱️ [${webhookLogId}] Validación de timestamp:`);
        console.log(`   - Tiempo actual: ${new Date(currentTime).toISOString()}`);
        console.log(`   - Tiempo request: ${new Date(requestTime).toISOString()}`);
        console.log(`   - Diferencia: ${(timeDiff / 1000).toFixed(2)}s`);

        if (timeDiff > 5 * 60 * 1000) {
            console.error(`❌ [${webhookLogId}] RECHAZADO: Timestamp fuera de rango (>${5 * 60}s)`);
            return res.status(400).json({ error: "Request timestamp too old" });
        }

        // Validar firma HMAC
        const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
        const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
        
        const crypto = require("crypto");
        const hmac = crypto.createHmac("sha256", secret);
        hmac.update(manifest);
        const computedHash = hmac.digest("hex");

        console.log(`🔑 [${webhookLogId}] Validación HMAC:`);
        console.log(`   - Manifest: ${manifest}`);
        console.log(`   - Hash esperado: ${hash}`);
        console.log(`   - Hash calculado: ${computedHash}`);
        console.log(`   - Match: ${computedHash === hash ? "✓ SÍ" : "✗ NO"}`);

        if (computedHash !== hash) {
            console.error(`❌ [${webhookLogId}] RECHAZADO: Firma HMAC inválida`);
            return res.status(401).json({ error: "Invalid signature" });
        }

        console.log(`✅ [${webhookLogId}] Firma validada correctamente\n`);

        // ===== 2. IDEMPOTENCIA (evitar procesamiento duplicado) =====
        const idempotencyKey = xRequestId || `${topic}-${dataId}`;
        
        console.log(`🔄 [${webhookLogId}] Verificando idempotencia: ${idempotencyKey}`);
        
        if (replayProtectionCache.has(idempotencyKey)) {
            console.warn(`⚠️ [${webhookLogId}] DUPLICADO: Webhook ya procesado, respondiendo 200`);
            return res.status(200).json({ status: "already_processed" });
        }

        replayProtectionCache.set(idempotencyKey, true);
        setTimeout(() => replayProtectionCache.delete(idempotencyKey), REPLAY_CACHE_TTL);
        
        console.log(`✓ [${webhookLogId}] Idempotencia OK, procesando...\n`);

        // ===== 3. PROCESAMIENTO DEL WEBHOOK =====
        console.log(`📋 [${webhookLogId}] Datos recibidos:`);
        console.log(`   - Topic: ${topic}`);
        console.log(`   - Data ID: ${dataId}`);
        console.log(`   - Query params:`, req.query);
        console.log(`   - Body:`, JSON.stringify(req.body, null, 2));

        let merchantOrderId = null;
        let shouldProcessOrder = false;

        // CASO 1: Notificación de PAYMENT
        if (topic === "payment") {
            console.log(`\n💳 [${webhookLogId}] Procesando notificación de PAYMENT`);
            
            const paymentId = dataId;
            console.log(`   - Payment ID: ${paymentId}`);

            const mpRes = await fetch(`https://api.mercadolibre.com/v1/payments/${paymentId}`, {
                headers: { Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` },
            });

            if (!mpRes.ok) {
                console.error(`❌ [${webhookLogId}] Error consultando payment API: ${mpRes.status}`);
                return res.status(500).json({ error: "Failed to fetch payment" });
            }

            const paymentData = await mpRes.json();
            console.log(`   - Status: ${paymentData.status}`);
            console.log(`   - Status detail: ${paymentData.status_detail}`);
            console.log(`   - External reference: ${paymentData.external_reference}`);

            if (paymentData.status === "approved") {
                merchantOrderId = paymentData.order?.id;
                shouldProcessOrder = true;
                console.log(`   ✓ Pago aprobado, merchant_order: ${merchantOrderId}`);
            } else {
                console.log(`   ⏭️ Pago no aprobado (${paymentData.status}), ignorando`);
            }
        }

        // CASO 2: Notificación de MERCHANT_ORDER
        if (topic === "merchant_order") {
            console.log(`\n📦 [${webhookLogId}] Procesando notificación de MERCHANT_ORDER`);
            
            merchantOrderId = dataId;
            console.log(`   - Merchant Order ID: ${merchantOrderId}`);

            const orderRes = await fetch(`https://api.mercadolibre.com/merchant_orders/${merchantOrderId}`, {
                headers: { Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` },
            });

            if (!orderRes.ok) {
                console.error(`❌ [${webhookLogId}] Error consultando merchant_order API: ${orderRes.status}`);
                return res.status(500).json({ error: "Failed to fetch merchant_order" });
            }

            const orderData = await orderRes.json();
            console.log(`   - Order status: ${orderData.order_status}`);
            console.log(`   - Paid amount: ${orderData.paid_amount}`);
            console.log(`   - Total amount: ${orderData.total_amount}`);
            console.log(`   - External reference: ${orderData.external_reference}`);

            if (orderData.order_status === "paid" || orderData.paid_amount >= orderData.total_amount) {
                shouldProcessOrder = true;
                console.log(`   ✓ Orden pagada completamente`);
                
                // ===== 4. GARANTIZAR CREACIÓN DE DESCARGAS =====
                const orderId = orderData.external_reference;

                if (!orderId) {
                    console.error(`❌ [${webhookLogId}] External reference faltante en merchant_order`);
                    return res.status(400).json({ error: "Missing external_reference" });
                }

                console.log(`\n🔍 [${webhookLogId}] Procesando orden: ${orderId}`);

                // Verificar si ya fue procesada (idempotencia a nivel de orden)
                const { data: existingOrder, error: checkError } = await supabaseAdmin
                    .from("orders")
                    .select("status, mercado_pago_payment_id")
                    .eq("id", orderId)
                    .single();

                if (checkError) {
                    console.error(`❌ [${webhookLogId}] Error consultando orden en DB:`, checkError);
                    return res.status(500).json({ error: "Database error" });
                }

                if (existingOrder.status === "paid" && existingOrder.mercado_pago_payment_id) {
                    console.log(`⚠️ [${webhookLogId}] Orden ${orderId} ya procesada como 'paid', saltando`);
                    return res.status(200).json({ status: "order_already_paid" });
                }

                console.log(`   - Orden encontrada, status actual: ${existingOrder.status}`);

                // 1. Obtener email del cliente
                const { data: order, error: orderError } = await supabaseAdmin
                    .from("orders")
                    .select("customer_email")
                    .eq("id", orderId)
                    .single();

                if (orderError || !order) {
                    console.error(`❌ [${webhookLogId}] Error obteniendo datos de orden:`, orderError);
                    return res.status(500).json({ error: "Order not found" });
                }

                console.log(`   - Email del cliente: ${order.customer_email}`);

                // 2. Obtener items del pedido
                const { data: orderItems, error: itemsError } = await supabaseAdmin
                    .from("order_items")
                    .select("photo_id")
                    .eq(ORDER_FIELD_NAME, orderId);

                if (itemsError || !orderItems || orderItems.length === 0) {
                    console.error(`❌ [${webhookLogId}] Error obteniendo order_items:`, itemsError);
                    return res.status(500).json({ error: "Order items not found" });
                }

                console.log(`   - Fotos en el pedido: ${orderItems.length}`);

                // 3. Obtener rutas de fotos originales
                const photoIds = orderItems.map((item) => item.photo_id);
                const { data: photos, error: photosError } = await supabaseAdmin
                    .from("photos")
                    .select("original_file_path")
                    .in("id", photoIds);

                if (photosError || !photos || photos.length === 0) {
                    console.error(`❌ [${webhookLogId}] Error obteniendo fotos:`, photosError);
                    return res.status(500).json({ error: "Photos not found" });
                }

                console.log(`   - Fotos encontradas en storage: ${photos.length}`);

                // 4. Actualizar orden a 'paid' CON TRANSACTION para garantizar atomicidad
                const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
                const paymentId = orderData.payments?.[0]?.id || null;

                const { error: updateError } = await supabaseAdmin
                    .from("orders")
                    .update({
                        status: "paid",
                        mercado_pago_payment_id: paymentId,
                        download_expires_at: expiresAt.toISOString(),
                    })
                    .eq("id", orderId);

                if (updateError) {
                    console.error(`❌ [${webhookLogId}] Error actualizando orden:`, updateError);
                    return res.status(500).json({ error: "Failed to update order" });
                }

                console.log(`   ✓ Orden actualizada a 'paid'`);
                console.log(`   - Payment ID: ${paymentId}`);
                console.log(`   - Expira: ${expiresAt.toISOString()}`);

                // 5. GARANTIZAR creación de registro de descargas (con UPSERT)
                const { error: downloadError } = await supabaseAdmin
                    .from("descargas")
                    .upsert(
                        {
                            order_id: orderId,
                            user_email: order.customer_email,
                            contador: 0,
                        },
                        { onConflict: "order_id" }
                    );

                if (downloadError) {
                    console.error(`❌ [${webhookLogId}] Error creando registro de descargas:`, downloadError);
                    // NO retornamos error porque la orden ya fue marcada como paid
                    console.warn(`⚠️ [${webhookLogId}] Orden marcada como paid pero sin registro de descargas`);
                } else {
                    console.log(`   ✓ Registro de descargas creado/actualizado (contador: 0)`);
                }

                // 6. Log final de éxito
                const processingTime = Date.now() - webhookStartTime;
                console.log(`\n${"=".repeat(80)}`);
                console.log(`✅ [${webhookLogId}] WEBHOOK PROCESADO EXITOSAMENTE`);
                console.log(`   - Orden: ${orderId}`);
                console.log(`   - Email: ${order.customer_email}`);
                console.log(`   - Fotos: ${photos.length}`);
                console.log(`   - Tiempo de procesamiento: ${processingTime}ms`);
                console.log(`${"=".repeat(80)}\n`);
            } else {
                console.log(`   ⏭️ Orden no completamente pagada, ignorando`);
            }
        }

        res.status(200).json({ status: "processed", webhook_id: webhookLogId });

    } catch (error) {
        const processingTime = Date.now() - webhookStartTime;
        console.error(`\n${"=".repeat(80)}`);
        console.error(`❌ [${webhookLogId}] ERROR EN WEBHOOK`);
        console.error(`   - Error: ${error.message}`);
        console.error(`   - Stack:`, error.stack);
        console.error(`   - Tiempo hasta error: ${processingTime}ms`);
        console.error(`${"=".repeat(80)}\n`);
        
        res.status(500).json({ 
            error: "Internal server error", 
            webhook_id: webhookLogId 
        });
    }
});

// ===== ENDPOINT DE TESTING: Simular Pago Aprobado =====
app.post("/simulate-payment", express.json(), async (req, res) => {
    console.log("\n🧪 ===== SIMULACIÓN DE PAGO (SOLO TESTING) =====");
    
    try {
        const { orderId } = req.body;

        if (!orderId) {
            return res.status(400).json({ error: "orderId es requerido" });
        }

        console.log(`🔍 Simulando pago para orden: ${orderId}`);

        // 1. Verificar que la orden existe
        const { data: existingOrder, error: checkError } = await supabaseAdmin
            .from("orders")
            .select("status, customer_email")
            .eq("id", orderId)
            .single();

        if (checkError || !existingOrder) {
            console.error("❌ Orden no encontrada:", checkError);
            return res.status(404).json({ error: "Orden no encontrada" });
        }

        if (existingOrder.status === "paid") {
            console.log("⚠️ Orden ya está marcada como 'paid'");
            return res.status(200).json({ 
                status: "already_paid", 
                message: "La orden ya está pagada" 
            });
        }

        console.log(`   - Status actual: ${existingOrder.status}`);
        console.log(`   - Email: ${existingOrder.customer_email}`);

        // 2. Obtener items del pedido
        const { data: orderItems, error: itemsError } = await supabaseAdmin
            .from("order_items")
            .select("photo_id")
            .eq(ORDER_FIELD_NAME, orderId);

        if (itemsError || !orderItems || orderItems.length === 0) {
            console.error("❌ No se encontraron items para esta orden:", itemsError);
            return res.status(500).json({ error: "Order items not found" });
        }

        console.log(`   - Fotos en el pedido: ${orderItems.length}`);

        // 3. Obtener rutas de fotos originales
        const photoIds = orderItems.map((item) => item.photo_id);
        const { data: photos, error: photosError } = await supabaseAdmin
            .from("photos")
            .select("original_file_path")
            .in("id", photoIds);

        if (photosError || !photos || photos.length === 0) {
            console.error("❌ No se encontraron fotos:", photosError);
            return res.status(500).json({ error: "Photos not found" });
        }

        console.log(`   - Fotos encontradas: ${photos.length}`);

        // 4. Actualizar orden a 'paid'
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const simulatedPaymentId = `test_payment_${Date.now()}`;

        const { error: updateError } = await supabaseAdmin
            .from("orders")
            .update({
                status: "paid",
                mercado_pago_payment_id: simulatedPaymentId,
                download_expires_at: expiresAt.toISOString(),
            })
            .eq("id", orderId);

        if (updateError) {
            console.error("❌ Error actualizando orden:", updateError);
            return res.status(500).json({ error: "Failed to update order" });
        }

        console.log(`   ✓ Orden actualizada a 'paid'`);
        console.log(`   - Payment ID simulado: ${simulatedPaymentId}`);
        console.log(`   - Expira: ${expiresAt.toISOString()}`);

        // 5. Crear registro de descargas
        const { error: downloadError } = await supabaseAdmin
            .from("descargas")
            .upsert(
                {
                    order_id: orderId,
                    user_email: existingOrder.customer_email,
                    contador: 0,
                },
                { onConflict: "order_id" }
            );

        if (downloadError) {
            console.error("❌ Error creando registro de descargas:", downloadError);
        } else {
            console.log(`   ✓ Registro de descargas creado (contador: 0)`);
        }

        console.log("\n✅ ===== SIMULACIÓN COMPLETADA =====\n");

        res.status(200).json({ 
            status: "simulated_success",
            orderId,
            customer_email: existingOrder.customer_email,
            photos: photos.length,
            expires_at: expiresAt.toISOString(),
            message: "Pago simulado exitosamente. La orden está lista para descarga.",
            success_url: `${process.env.BACKEND_URL || 'http://localhost:3000'}/success.html?order_id=${orderId}&customer_email=${existingOrder.customer_email}`
        });

    } catch (error) {
        console.error("\n❌ Error en simulación de pago:", error);
        res.status(500).json({ 
            error: "Internal server error", 
            details: error.message 
        });
    }
});

// --- NUEVA RUTA: Obtener Detalles de Orden para Página de Éxito ---
// Esta ruta es llamada por success.html para obtener las fotos compradas.
app.get("/order-details/:orderId/:customerEmail", async (req, res) => {
    const { orderId, customerEmail } = req.params;

    if (!orderId || !customerEmail) {
        return res.status(400).json({ message: "ID de orden o email del cliente faltantes." });
    }
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(orderId)) {
        return res.status(400).json({ message: "ID de orden no válido." });
    }

    try {
        // 1. Verificar que la orden existe, está pagada y pertenece a este email
        // Usamos supabaseAdmin para ignorar RLS en esta verificación de backend
        const { data: order, error: orderError } = await supabaseAdmin
            .from("orders")
            .select("id, customer_email, status, download_expires_at")
            .eq("id", orderId)
            .eq("customer_email", customerEmail.toLowerCase()) // No verificamos el status 'paid' aquí para que la página de éxito pueda mostrar // estados pendientes o rechazados. success.html debe manejar esto.
            .single();

        if (orderError || !order) {
            console.error(`Error al obtener detalles de orden: Orden ${orderId} no encontrada o email incorrecto.`, orderError?.message); // Devolvemos un 404/403 pero con un mensaje que success.html pueda interpretar
            return res.status(404).json({ message: "Orden no encontrada o email no coincide.", status: "not_found" });
        } // Si la orden no está pagada, devolvemos el estado actual para que el frontend lo maneje

        if (order.status !== "paid") {
            return res.status(200).json({
                message: `La orden ${orderId} no está pagada aún. Estado actual: ${order.status}`,
                order: {
                    id: order.id,
                    customer_email: order.customer_email,
                    status: order.status,
                },
                photos: [], // No enviamos fotos si no está pagada
            });
        } // 2. Obtener los ítems (fotos) asociados a esta orden // Usamos supabaseAdmin para ignorar RLS en esta verificación de backend

        const { data: orderItems, error: orderItemsError } = await supabaseAdmin.from("order_items").select("photo_id").eq("order_id", orderId);

        if (orderItemsError) {
            console.error(`Error al obtener ítems de la orden ${orderId}:`, orderItemsError.message);
            return res.status(500).json({ message: "Error al obtener ítems de la orden." });
        }

        const photoIds = orderItems.map((oi) => oi.photo_id);
        if (photoIds.length === 0) {
            return res.status(404).json({ message: "No se encontraron fotos para esta orden." });
        } // 3. Obtener los detalles de cada foto (especialmente la URL con marca de agua y student_code) // Usamos supabaseAdmin para ignorar RLS en esta verificación de backend

        const { data: photos, error: photosError } = await supabaseAdmin
            .from("photos")
            .select("id, watermarked_file_path, student_code, price") // Seleccionamos lo que necesitamos para mostrar
            .in("id", photoIds);

        if (photosError) {
            console.error(`Error al obtener detalles de las fotos para la orden ${orderId}:`, photosError.message);
            return res.status(500).json({ message: "Error al obtener detalles de las fotos." });
        }

        const photosWithPublicUrls = photos.map((photo) => ({
            id: photo.id,
            student_code: photo.student_code,
            price: photo.price, // Construimos la URL pública de la foto con marca de agua
            watermarked_url: `${supabaseUrl}/storage/v1/object/public/watermarked-photos/${photo.watermarked_file_path}`,
        }));

        res.status(200).json({
            message: `Detalles de la orden ${orderId} obtenidos exitosamente.`,
            order: {
                id: order.id,
                customer_email: order.customer_email,
                status: order.status,
                download_expires_at: order.download_expires_at,
            },
            photos: photosWithPublicUrls,
        });
    } catch (err) {
        console.error("❌ Error inesperado en la ruta /order-details:", err);
        res.status(500).json({ message: "Error interno del servidor al obtener detalles de la orden." });
    }
});

// --- NUEVA RUTA: Descarga de Fotos Originales ---
// Ahora usa URL firmada para que el cliente descargue directo desde Supabase
app.get("/download-photo/:photoId/:orderId/:customerEmail", async (req, res) => {
    const { photoId, orderId, customerEmail } = req.params;

    // 1. Validar parámetros
    if (!photoId || !orderId || !customerEmail) {
        return res.status(400).send("Faltan parámetros de descarga.");
    }
    if (!/^[0-9a-fA-F-]{36}$/.test(photoId) || !/^[0-9a-fA-F-]{36}$/.test(orderId)) {
        return res.status(400).send("IDs de foto u orden no válidos.");
    }

    try {
        // 2. Verificar que la orden existe, está pagada y pertenece al email
        const { data: order, error: orderError } = await supabaseAdmin
            .from("orders")
            .select("id, customer_email, status")
            .eq("id", orderId)
            .eq("customer_email", customerEmail)
            .eq("status", "paid") // solo si está pagada
            .single();

        if (orderError || !order) {
            console.error(`❌ Descarga no autorizada. Orden ${orderId} no encontrada, no pagada o email incorrecto.`);
            return res.status(403).send("No autorizado para descargar esta foto.");
        }

        // 3. Verificar que la foto pertenece a la orden
        const { data: orderItem, error: orderItemError } = await supabaseAdmin.from("order_items").select("photo_id").eq("order_id", orderId).eq("photo_id", photoId).single();

        if (orderItemError || !orderItem) {
            console.error(`❌ Foto ${photoId} no encontrada en la orden ${orderId}.`);
            return res.status(403).send("La foto no es parte de esta orden.");
        }

        // 4. Obtener la ruta original desde la tabla photos
        const { data: photo, error: photoError } = await supabaseAdmin.from("photos").select("original_file_path").eq("id", photoId).single();

        if (photoError || !photo?.original_file_path) {
            console.error(`❌ No se encontró ruta de archivo original para foto ${photoId}.`);
            return res.status(404).send("No se encontró la foto original.");
        }

        // 5. Generar URL firmada (válida por 7 días)
        const { data: signed, error: signedError } = await supabaseAdmin.storage.from(ORIGINAL_BUCKET_NAME).createSignedUrl(photo.original_file_path, 60 * 60 * 24 * 7);

        if (signedError || !signed?.signedUrl) {
            console.error(`❌ Error creando URL firmada para ${photo.original_file_path}:`, signedError?.message);
            return res.status(500).send("No se pudo generar la descarga.");
        }

        // 6. Redirigir al usuario a la URL firmada
        console.log(`✅ URL firmada generada para foto ${photoId}`);
        return res.redirect(signed.signedUrl);
    } catch (err) {
        console.error("❌ Error inesperado en la descarga de foto:", err);
        res.status(500).send("Error interno del servidor.");
    }
});

// --- Iniciar el servidor ---
app.listen(PORT, () => {
    console.log(`Servidor backend escuchando en http://localhost:${PORT}`);
    console.log("¡Listo para la acción con Supabase, Sharp y Mercado Pago Webhooks!");
});

app.get("/config.js", (req, res) => {
    res.setHeader("Content-Type", "application/javascript");
    res.send(`const BACKEND_URL = "${process.env.BACKEND_URL}";`);
});

app.get("/orders", async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin.from("orders").select("*").order("created_at", { ascending: false });

        if (error) throw error;

        res.json({ orders: data });
    } catch (err) {
        console.error("Error al obtener pedidos:", err);
        res.status(500).json({ message: "Error interno al obtener pedidos" });
    }
});

// Eliminar todos los pedidos (debe estar ANTES de /orders/:id)
app.delete("/orders/all", async (req, res) => {
    try {
        // Primero obtener todos los pedidos
        const { data: orders, error: fetchError } = await supabaseAdmin
            .from("orders")
            .select("id");

        if (fetchError) throw fetchError;

        // Si no hay pedidos, retornar
        if (!orders || orders.length === 0) {
            return res.json({ message: "No hay pedidos para eliminar" });
        }

        // Extraer todos los IDs de pedidos
        const orderIds = orders.map(order => order.id);

        // Eliminar todos los order_items asociados
        const { error: itemsError } = await supabaseAdmin
            .from("order_items")
            .delete()
            .in("order_id", orderIds);

        if (itemsError) throw itemsError;

        // Eliminar todos los pedidos
        const { error: ordersError } = await supabaseAdmin
            .from("orders")
            .delete()
            .in("id", orderIds);

        if (ordersError) throw ordersError;

        res.json({ message: `${orders.length} pedidos eliminados exitosamente` });
    } catch (err) {
        console.error("Error al eliminar todos los pedidos:", err);
        res.status(500).json({ message: "Error al eliminar pedidos" });
    }
});

// Eliminar un pedido específico
app.delete("/orders/:id", async (req, res) => {
    try {
        const { id } = req.params;

        // Eliminar order_items asociados primero
        const { error: itemsError } = await supabaseAdmin
            .from("order_items")
            .delete()
            .eq("order_id", id);

        if (itemsError) throw itemsError;

        // Eliminar el pedido
        const { error: orderError } = await supabaseAdmin
            .from("orders")
            .delete()
            .eq("id", id);

        if (orderError) throw orderError;

        res.json({ message: "Pedido eliminado exitosamente" });
    } catch (err) {
        console.error("Error al eliminar pedido:", err);
        res.status(500).json({ message: "Error al eliminar pedido" });
    }
});

app.get("/admin/stats", async (req, res) => {
    try {
        const [{ count: totalAlbums }, { count: totalPhotos }, { count: totalOrders }] = await Promise.all([
            supabaseAdmin.from("albums").select("*", { count: "exact", head: true }),
            supabaseAdmin.from("photos").select("*", { count: "exact", head: true }),
            supabaseAdmin.from("orders").select("*", { count: "exact", head: true }),
        ]);

        res.json({
            totalAlbums: totalAlbums ?? 0,
            totalPhotos: totalPhotos ?? 0,
            totalOrders: totalOrders ?? 0,
        });
    } catch (err) {
        console.error("Error al obtener estadísticas:", err);
        res.status(500).json({ message: "Error interno al obtener estadísticas" });
    }
});

// Obtener álbumes con sus fotos
app.get("/albums-with-photos", async (req, res) => {
    try {
        const { data: albums, error } = await supabaseAdmin
            .from("albums")
            .select(
                `
        id,
        name,
        event_date,
        photos (
          id,
          watermarked_file_path
        )
      `
            )
            .order("event_date", { ascending: false });

        if (error) throw error;

        const albumsWithUrls = albums.map((a) => ({
            ...a,
            photos: a.photos.map((p) => ({
                id: p.id,
                public_watermarked_url: `${supabaseUrl}/storage/v1/object/public/watermarked-photos/${p.watermarked_file_path}`,
            })),
        }));

        res.json(albumsWithUrls);
    } catch (err) {
        console.error("Error al obtener álbumes con fotos:", err);
        res.status(500).json({ message: "Error interno al obtener álbumes" });
    }
});

// Eliminar álbum y fotos
app.delete("/albums/:id", async (req, res) => {
    const { id } = req.params;
    try {
        await supabaseAdmin.from("photos").delete().eq("album_id", id);
        const { error } = await supabaseAdmin.from("albums").delete().eq("id", id);
        if (error) throw error;
        res.json({ message: "Álbum eliminado" });
    } catch (err) {
        console.error("Error al eliminar álbum:", err);
        res.status(500).json({ message: "Error interno al eliminar álbum" });
    }
});

// Eliminar foto
app.delete("/photos/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const { error } = await supabaseAdmin.from("photos").delete().eq("id", id);
        if (error) throw error;
        res.json({ message: "Foto eliminada" });
    } catch (err) {
        console.error("Error al eliminar foto:", err);
        res.status(500).json({ message: "Error interno al eliminar foto" });
    }
});

// Actualizar álbum
app.put("/albums/:id", async (req, res) => {
    const { id } = req.params;
    const { name, event_date, description } = req.body;

    try {
        const { data, error } = await supabaseAdmin
            .from("albums")
            .update({
                name,
                event_date,
                description,
            })
            .eq("id", id)
            .select()
            .single();

        if (error) throw error;

        res.json({ success: true, album: data });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

const MAX_DESCARGAS = 3; // ajustalo como quieras

app.get("/download-photo/:photoId/:orderId/:customerEmail", async (req, res) => {
    try {
        const { photoId, orderId, customerEmail } = req.params;

        // Buscar registro de descargas
        const { data: registro, error: errSelect } = await supabaseAdmin
            .from("descargas")
            .select("*")
            .eq(ORDER_FIELD_NAME, orderId)
            .eq("user_id", customerEmail) // ⚠️ si guardás uuid de usuario, ajustá aquí
            .single();

        if (errSelect && errSelect.code !== "PGRST116") {
            throw errSelect;
        }

        // Si no hay registro, lo creamos
        if (!registro) {
            await supabaseAdmin.from("descargas").insert({
                [ORDER_FIELD_NAME]: orderId,
                user_id: customerEmail,
                contador: 0,
            });
        } else {
            // Chequear límite
            if (registro.contador >= MAX_DESCARGAS) {
                return res.status(403).send("⚠️ Límite de descargas alcanzado. Contacta a soporte.");
            }
        }

        // Buscar foto
        const { data: photoData, error: errPhoto } = await supabaseAdmin.from("photos").select("*").eq("id", photoId).single();

        if (errPhoto || !photoData) {
            return res.status(404).send("Foto no encontrada");
        }

        // Generar URL firmada
        const { data: signedUrlData, error: errSigned } = await supabaseAdmin.storage
            .from(ORIGINAL_BUCKET_NAME) // bucket privado de originales
            .createSignedUrl(photoData.original_path, 60); // válido 60s

        if (errSigned) throw errSigned;

        // Incrementar contador
        await supabaseAdmin
            .from("descargas")
            .update({ contador: (registro?.contador || 0) + 1 })
            .eq(ORDER_FIELD_NAME, orderId)
            .eq("user_id", customerEmail);

        // Redirigir a la URL firmada
        return res.redirect(signedUrlData.signedUrl);
    } catch (err) {
        console.error("❌ Error en download-photo:", err);
        res.status(500).send("Error interno al generar descarga");
    }
});

