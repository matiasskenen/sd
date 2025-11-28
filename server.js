// Carga las variables de entorno PRIMERO
require("dotenv").config();

console.log("=== ENTORNO DETECTADO ===");
console.log("process.env.RENDER:", process.env.RENDER ? "Render" : "Local");
console.log("Webhook secret (masked):", process.env.MERCADOPAGO_WEBHOOK_SECRET?.slice(0, 4) + "****" + process.env.MERCADOPAGO_WEBHOOK_SECRET?.slice(-4));
console.log("===========================");

// server.js
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const multer = require("multer");
const sharp = require("sharp"); // Para el procesamiento de imágenes
const path = require("path"); // Para manejar rutas de archivos
const fs = require("fs"); // Para verificar si la marca de agua existe (opcional, pero buena práctica)
const mercadopago = require("mercadopago"); // Importa el módulo completo de mercadopago
const cors = require("cors"); // Importa el módulo CORS
const rateLimit = require("express-rate-limit"); // Rate limiting
const helmet = require("helmet"); // Security headers
const { requireAuth, optionalAuth } = require("./middleware/auth"); // Middleware de autenticación

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy - CRÍTICO para Render/Heroku/producción detrás de reverse proxy
app.set("trust proxy", 1);

// --- Sistema de Logging y Métricas ---
const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
};

let currentLogLevel = process.env.LOG_LEVEL || "INFO";
let consoleLoggingEnabled = true;

// Buffer circular para logs (últimos 1000)
const MAX_LOGS = 1000;
const logBuffer = [];

// Métricas del servidor
const metrics = {
    startTime: Date.now(),
    requests: {
        total: 0,
        byEndpoint: {},
        byStatusCode: {},
    },
    errors: {
        total: 0,
        byType: {},
    },
    photos: {
        uploaded: 0,
        downloaded: 0,
    },
    albums: {
        created: 0,
    },
    orders: {
        created: 0,
        paid: 0,
    },
    responseTimes: [],
};

// Logger centralizado
const logger = {
    _log: (level, message, metadata = {}) => {
        if (LOG_LEVELS[level] < LOG_LEVELS[currentLogLevel.toUpperCase()]) {
            return; // No loggear si el nivel es menor al configurado
        }

        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            metadata: sanitizeMetadata(metadata),
        };

        // Agregar al buffer (circular)
        logBuffer.push(logEntry);
        if (logBuffer.length > MAX_LOGS) {
            logBuffer.shift();
        }

        // Log a consola si está habilitado
        if (consoleLoggingEnabled) {
            const emoji = { DEBUG: "🔍", INFO: "ℹ️", WARN: "⚠️", ERROR: "❌" }[level] || "";
            // console.log(`${emoji} [${timestamp}] [${level}] ${message}`, metadata && Object.keys(metadata).length > 0 ? metadata : "");
        }
    },
    debug: (msg, meta) => logger._log("DEBUG", msg, meta),
    info: (msg, meta) => logger._log("INFO", msg, meta),
    warn: (msg, meta) => logger._log("WARN", msg, meta),
    error: (msg, meta) => logger._log("ERROR", msg, meta),
};

// Sanitizar metadata para evitar loggear tokens/passwords
function sanitizeMetadata(metadata) {
    if (!metadata || typeof metadata !== "object") return metadata;

    const sanitized = { ...metadata };
    const sensitiveKeys = ["password", "token", "authorization", "secret", "key", "access_token"];

    for (const key in sanitized) {
        if (sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive))) {
            sanitized[key] = "***REDACTED***";
        }
    }

    return sanitized;
}

// Middleware para tracking de métricas
app.use((req, res, next) => {
    const startTime = Date.now();

    metrics.requests.total++;
    metrics.requests.byEndpoint[req.path] = (metrics.requests.byEndpoint[req.path] || 0) + 1;

    res.on("finish", () => {
        const duration = Date.now() - startTime;
        metrics.responseTimes.push(duration);
        if (metrics.responseTimes.length > 100) {
            metrics.responseTimes.shift();
        }

        metrics.requests.byStatusCode[res.statusCode] = (metrics.requests.byStatusCode[res.statusCode] || 0) + 1;

        logger.debug(`${req.method} ${req.path}`, {
            statusCode: res.statusCode,
            duration: `${duration}ms`,
        });
    });

    next();
});

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
                // console.log(`Intento ${i + 1} sin pagos. Esperando 3s...`);
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
                // console.log(`Intento ${i + 1} falló al obtener Payment. Reintentando en 3s...`);
                await new Promise((res) => setTimeout(res, 3000));
            } else {
                throw err;
            }
        }
    }
}

// --- Middlewares ---
// SEGURIDAD: Helmet para headers HTTP seguros
app.use(
    helmet({
        contentSecurityPolicy: false, // Deshabilitado porque usamos CDN de Tailwind
        crossOriginEmbedderPolicy: false, // Necesario para imágenes de Supabase
        hsts: process.env.NODE_ENV === "production" ? { maxAge: 31536000 } : false,
    })
);

// SEGURIDAD: CORS configurado con whitelist
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",") : ["https://school-photos-backend.onrender.com"]; // Valor por defecto para producción

const corsOptions = {
    origin: function (origin, callback) {
        // Permitir requests sin origin (como mobile apps, Postman, curl)
        if (!origin) return callback(null, true);

        // En desarrollo, permitir localhost
        console.log("🔍 CORS CHECK:", { 
            origin, 
            NODE_ENV: process.env.NODE_ENV, 
            isDev: process.env.NODE_ENV !== 'production' 
        });
        
        if (process.env.NODE_ENV !== 'production') {
            console.log("✅ Permitido por NODE_ENV");
            return callback(null, true);
        }

        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            logger.warn("CORS bloqueado", { origin });
            callback(new Error("No permitido por CORS"));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

// SEGURIDAD: Rate limiting general
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // Límite de 100 requests por ventana
    message: "Demasiadas peticiones desde esta IP, por favor intenta más tarde.",
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn("Rate limit excedido", {
            ip: req.ip,
            path: req.path,
        });
        res.status(429).json({
            error: "Demasiadas peticiones, por favor intenta más tarde.",
            retryAfter: "15 minutos",
        });
    },
});

// SEGURIDAD: Rate limiting estricto para login
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // Solo 5 intentos de login
    message: "Demasiados intentos de login, por favor intenta más tarde.",
    skipSuccessfulRequests: false, // Contar todos los intentos
    handler: (req, res) => {
        logger.warn("Rate limit de auth excedido", {
            ip: req.ip,
            email: req.body?.email,
        });
        res.status(429).json({
            error: "Demasiados intentos de login. Por seguridad, espera 15 minutos.",
            retryAfter: "15 minutos",
        });
    },
});

// SEGURIDAD: Rate limiting para creación de recursos
const createLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 20, // 20 creaciones por hora
    message: "Límite de creación alcanzado.",
    handler: (req, res) => {
        logger.warn("Rate limit de creación excedido", {
            ip: req.ip,
            path: req.path,
        });
        res.status(429).json({
            error: "Has alcanzado el límite de creaciones por hora.",
            retryAfter: "1 hora",
        });
    },
});

// SEGURIDAD: Rate limiting para webhooks (más permisivo)
const webhookLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 30, // 30 requests por minuto
    message: "Webhook rate limit excedido",
});

// Aplicar rate limiting general a todas las rutas
app.use(generalLimiter);

app.use(express.json()); // Para parsear cuerpos de petición JSON
app.use(express.urlencoded({ extended: true })); // Para parsear datos de formularios URL-encoded

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

// --- NUEVAS RUTAS: Gestión de Álbumes (MULTI-TENANT) ---

// Ruta para obtener todos los álbumes del fotógrafo autenticado
app.get("/albums", requireAuth, async (req, res) => {
    try {
        const photographerId = req.photographer.id;

        const { data: albums, error } = await supabaseAdmin
            .from("albums")
            .select("id, name, event_date, description, price_per_photo, created_at")
            .eq("photographer_id", photographerId)
            .order("created_at", { ascending: false });

        if (error) {
            logger.error("Error al obtener álbumes", { error: error.message, photographerId });
            return res.status(500).json({ message: `Error al obtener álbumes: ${error.message}` });
        }
        
        res.status(200).json({ message: "Álbumes obtenidos exitosamente.", albums });
    } catch (err) {
        console.error("Error inesperado al obtener álbumes:", err);
        res.status(500).json({ message: "Error interno del servidor al obtener álbumes." });
    }
});

// Ruta para crear un nuevo álbum (CON RATE LIMITING Y AUTH)
app.post("/albums", requireAuth, createLimiter, async (req, res) => {
    const { name, event_date, description, price_per_photo } = req.body;
    const photographerId = req.photographer.id;

    if (!name) {
        return res.status(400).json({ message: "El nombre del álbum es requerido." });
    }
    if (!event_date) {
        return res.status(400).json({ message: "La fecha del evento es requerida para el álbum." });
    }

    // Usar precio por defecto del fotógrafo si no se especifica
    const finalPrice = price_per_photo ? Number(price_per_photo) : req.photographer.default_price_per_photo || 1500.0;

    logger.info("Creando nuevo álbum", { name, event_date, price_per_photo: finalPrice, photographerId });

    try {
        const { data: album, error } = await supabaseAdmin
            .from("albums")
            .insert({
                name,
                event_date,
                description: description || null,
                price_per_photo: finalPrice,
                photographer_id: photographerId,
            })
            .select()
            .single();

        if (error) {
            logger.error("Error al crear álbum", { error: error.message });
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

        logger.info("Fotos obtenidas para galería", { albumId, count: photos.length });

        res.status(200).json({
            message: `Fotos obtenidas exitosamente para el álbum ${albumId}.`,
            photos: photosWithPublicUrls,
        });
    } catch (err) {
        console.error("Error inesperado al obtener fotos:", err);
        res.status(500).json({ message: "Error inesperado del servidor" });
    }
});

// Importar rutas
const authRoutes = require('./routes/auth');
const subscriptionRoutes = require('./routes/subscriptions');

// Montar rutas
app.use('/auth', authLimiter, authRoutes);
app.use('/subscriptions', subscriptionRoutes);

// Ruta de login legacy (mantener por compatibilidad)
app.post("/login", authLimiter, async (req, res) => {
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
        // Obtener photographer_id desde la primera foto del carrito
        const firstPhotoId = cart[0].photoId;
        const { data: photoData } = await supabaseAdmin
            .from("photos")
            .select("album_id, albums!inner(photographer_id)")
            .eq("id", firstPhotoId)
            .single();

        if (!photoData) {
            return res.status(404).json({ message: "Foto no encontrada" });
        }

        const photographerId = photoData.albums.photographer_id;

        // 1) Crear order con photographer_id
        const { data: orderData, error: orderErr } = await supabaseAdmin
            .from("orders")
            .insert({
                customer_email: customerEmail,
                total_amount: totalAmount,
                status: "pending",
                photographer_id: photographerId,
            })
            .select()
            .single();
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

        // console.log(prefBody);
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

app.post("/upload-photos/:albumId", requireAuth, upload.array("photos"), async (req, res) => {
    const albumId = req.params.albumId;
    const photographerId = req.photographer.id;

    if (!albumId || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(albumId)) {
        return res.status(400).json({ message: "ID de álbum no válido." });
    }

    let albumPrice; // Declarar fuera del try para que sea accesible en todo el scope

    try {
        // Obtener álbum Y su precio - verificar que pertenece al fotógrafo autenticado
        const { data: album, error: albumError } = await supabaseAdmin
            .from("albums")
            .select("id, photographer_id, price_per_photo")
            .eq("id", albumId)
            .eq("photographer_id", photographerId)
            .single();

        if (albumError || !album) {
            console.error("Error al verificar álbum:", albumError ? albumError.message : "Álbum no encontrado.");
            return res.status(404).json({ message: "Álbum no encontrado o no autorizado para este fotógrafo." });
        }

        // Precio del álbum (con fallback al precio por defecto del fotógrafo)
        albumPrice = album.price_per_photo || req.photographer.default_price_per_photo || 1500.0;
        logger.info("Subida de fotos iniciada", { albumId, albumPrice, photographerId });
    } catch (dbError) {
        console.error("Error de base de datos al verificar álbum:", dbError);
        return res.status(500).json({ message: "Error interno del servidor al verificar el álbum." });
    }

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: "No se subieron archivos." });
    }

    const watermarkedPhotosPath = path.resolve(__dirname, "assets", "watermark.png");
    // console.log("Intentando cargar marca de agua desde:", watermarkedPhotosPath);
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
                        price: albumPrice,
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

// Cache para protección anti-replay en webhooks
const replayProtectionCache = new Map();
const REPLAY_CACHE_TTL = 5 * 60 * 1000; // 5 minutos TTL

// --- WEBHOOK DE MERCADO PAGO (CON RATE LIMITING) ---
const crypto = require("crypto");

app.post("/mercadopago-webhook", webhookLimiter, express.json(), async (req, res) => {
    const now = new Date();
    const timestamp = now.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
    const MP_BASE_URL = "https://api.mercadopago.com";

    try {
        // --------- HEADERS Y DATOS BÁSICOS ---------
        const xSignature = req.headers["x-signature"];
        const xRequestId = req.headers["x-request-id"] || "no-request-id";

        const dataId = req.query["data.id"] || req.query.id || req.body.data?.id;

        const topic = req.query.type || req.query.topic || req.body.type;

        // --------- VALIDACIÓN DE SIGNATURE ---------
        if (!xSignature) {
            console.log(`[${timestamp}] ❌ Webhook sin x-signature - Topic: ${topic}, ID: ${dataId}`);
            return res.status(200).json({ status: "missing_signature_ignored" });
        }

        const parts = xSignature.split(",");
        let ts, hash;
        for (const part of parts) {
            const [key, value] = part.split("=");
            if (!key || !value) continue;
            const k = key.trim();
            const v = value.trim();
            if (k === "ts") ts = v;
            if (k === "v1") hash = v;
        }

        if (!ts || !hash) {
            console.log(`[${timestamp}] ❌ Signature inválida (formato) - Topic: ${topic}, ID: ${dataId}`);
            return res.status(200).json({ status: "invalid_signature_format_ignored" });
        }

        const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET || "";
        const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

        const computedHash = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

        if (computedHash !== hash) {
            console.log(`[${timestamp}] ❌ HMAC inválido - Topic: ${topic}, ID: ${dataId}`);
            return res.status(200).json({ status: "invalid_signature_ignored" });
        }

        // --------- IDEMPOTENCIA ---------
        const idempotencyKey = xRequestId || `${topic}-${dataId}`;
        if (replayProtectionCache.has(idempotencyKey)) {
            return res.status(200).json({ status: "already_processed" });
        }
        replayProtectionCache.set(idempotencyKey, true);
        setTimeout(() => replayProtectionCache.delete(idempotencyKey), REPLAY_CACHE_TTL);

        // =================================================
        //   CASO 1: PAYMENT
        // =================================================
        if (topic === "payment") {
            console.log(`\n[${timestamp}] 💳 PAYMENT WEBHOOK - ID: ${dataId}`);

            // esperar un toque a que MP tenga el payment listo
            await new Promise((r) => setTimeout(r, 3000));

            const consultaTime = new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
            console.log(`   [${consultaTime}] 🔍 Consultando payment en API de MP...`);

            const mpRes = await fetch(`${MP_BASE_URL}/v1/payments/${dataId}`, {
                headers: { Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` },
            });

            console.log(`   Response status: ${mpRes.status}`);

            if (!mpRes.ok) {
                console.log(`[${timestamp}] ⏳ Payment ${dataId} aún no existe (${mpRes.status})`);
                return res.status(200).json({ status: "payment_not_ready_yet" });
            }

            const paymentData = await mpRes.json();

            if (paymentData.status !== "approved") {
                console.log(`   ⏭️ Payment no aprobado (${paymentData.status}), ignorando`);
                return res.status(200).json({ status: "not_approved" });
            }

            const merchantOrderId = paymentData.order?.id;
            if (!merchantOrderId) {
                console.log(`   ⚠️ Payment aprobado pero sin merchant_order`);
                return res.status(200).json({ status: "no_merchant_order" });
            }

            console.log(`   ➡️ Procesando merchant_order: ${merchantOrderId}`);

            const orderRes = await fetch(`${MP_BASE_URL}/merchant_orders/${merchantOrderId}`, {
                headers: { Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` },
            });

            if (!orderRes.ok) {
                console.log(`   ❌ Error consultando merchant_order: ${orderRes.status}`);
                return res.status(500).json({ error: "Failed to fetch merchant_order" });
            }

            const orderData = await orderRes.json();
            const success = await procesarOrden(orderData, timestamp);

            if (success) {
                console.log(`[${timestamp}] ✅ Payment ${dataId} procesado - Orden: ${orderData.external_reference}`);
            }

            return res.status(200).json({ status: "processed" });
        }

        // =================================================
        //   CASO 2: MERCHANT_ORDER
        // =================================================
        if (topic === "merchant_order") {
            console.log(`\n[${timestamp}] 📦 MERCHANT_ORDER WEBHOOK - ID: ${dataId}`);

            const orderRes = await fetch(`${MP_BASE_URL}/merchant_orders/${dataId}`, {
                headers: { Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` },
            });

            if (!orderRes.ok) {
                console.log(`[${timestamp}] ❌ Error consultando merchant_order ${dataId}: ${orderRes.status}`);
                return res.status(500).json({ error: "Failed to fetch merchant_order" });
            }

            const orderData = await orderRes.json();
            const success = await procesarOrden(orderData, timestamp);

            if (success) {
                console.log(`[${timestamp}] ✅ Merchant Order ${dataId} procesado - Orden: ${orderData.external_reference}`);
            }

            return res.status(200).json({ status: "processed" });
        }

        // Otros topics → ignorados pero respondemos 200
        console.log(`[${timestamp}] ℹ️ Topic ignorado: ${topic} - ID: ${dataId}`);
        return res.status(200).json({ status: "ignored_topic" });
    } catch (error) {
        console.log(`[${timestamp}] ❌ ERROR WEBHOOK: ${error.message}`);
        return res.status(500).json({ error: "Internal server error" });
    }
});


// Función auxiliar para procesar orden
async function procesarOrden(orderData, timestamp) {
    // console.log(`   Order status: ${orderData.order_status}`);
    // console.log(`   Paid amount: ${orderData.paid_amount}`);
    // console.log(`   Total amount: ${orderData.total_amount}`);
    // console.log(`   External reference: ${orderData.external_reference}`);

    if (orderData.order_status !== "paid" && orderData.paid_amount < orderData.total_amount) {
        // console.log(`   ⏭️ Orden no completamente pagada, ignorando`);
        return;
    }

    const orderId = orderData.external_reference;

    if (!orderId) {
        // console.log(`   ❌ External reference faltante`);
        return;
    }

    // console.log(`\n[${timestamp}] 🔍 PROCESANDO ORDEN: ${orderId}`);

    // Verificar si existe la orden
    const { data: orders, error: checkError } = await supabaseAdmin
        .from("orders")
        .select("status, mercado_pago_payment_id, customer_email")
        .eq("id", orderId);

    if (checkError || !orders || orders.length === 0) {
        // console.log(`   ❌ Orden no encontrada en DB:`, checkError?.message || "No existe");
        return;
    }

    const existingOrder = orders[0];
    // console.log(`   Status actual en DB: ${existingOrder.status}`);
    // console.log(`   Email: ${existingOrder.customer_email}`);

    if (existingOrder.status === "paid" && existingOrder.mercado_pago_payment_id) {
        // console.log(`   ⏭️ Ya procesada anteriormente, saltando`);
        return;
    }

    const order = existingOrder;

    // console.log(`   Email: ${order.customer_email}`);

    // Obtener items del pedido
    const { data: orderItems, error: itemsError } = await supabaseAdmin.from("order_items").select("photo_id").eq(ORDER_FIELD_NAME, orderId);

    if (itemsError || !orderItems || orderItems.length === 0) {
        // console.log(`   ❌ Error obteniendo items:`, itemsError?.message);
        return;
    }

    // console.log(`   Fotos en pedido: ${orderItems.length}`);

    // Actualizar orden a 'paid'
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
        // console.log(`   ❌ Error actualizando orden:`, updateError.message);
        return;
    }

    // console.log(`   ✅ Orden actualizada a 'paid'`);
    // console.log(`   Payment ID: ${paymentId}`);
    // console.log(`   Expira: ${expiresAt.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}`);

    // Crear registro de descargas (si no existe)
    const { data: existingDownload } = await supabaseAdmin
        .from("descargas")
        .select("*")
        .eq("order_id", orderId)
        .single();

    if (!existingDownload) {
        const { error: downloadError } = await supabaseAdmin.from("descargas").insert({
            order_id: orderId,
            user_email: order.customer_email,
            contador: 0,
        });

        if (downloadError) {
            // console.log(`   ⚠️ Error creando registro de descargas:`, downloadError.message);
        } else {
            // console.log(`   ✅ Registro de descargas creado`);
        }
    } else {
        // console.log(`   ℹ️ Registro de descargas ya existe`);
    }

    // console.log(`\n✅ ORDEN ${orderId} PROCESADA EXITOSAMENTE\n`);
}

// ===== ENDPOINT DE TESTING: Simular Pago Aprobado =====
app.post("/simulate-payment", express.json(), async (req, res) => {
    // console.log("\n🧪 ===== SIMULACIÓN DE PAGO (SOLO TESTING) =====");

    try {
        const { orderId } = req.body;

        if (!orderId) {
            return res.status(400).json({ error: "orderId es requerido" });
        }

        // console.log(`🔍 Simulando pago para orden: ${orderId}`);

        // 1. Verificar que la orden existe
        const { data: existingOrder, error: checkError } = await supabaseAdmin.from("orders").select("status, customer_email").eq("id", orderId).single();

        if (checkError || !existingOrder) {
            console.error("❌ Orden no encontrada:", checkError);
            return res.status(404).json({ error: "Orden no encontrada" });
        }

        if (existingOrder.status === "paid") {
            // console.log("⚠️ Orden ya está marcada como 'paid'");
            return res.status(200).json({
                status: "already_paid",
                message: "La orden ya está pagada",
            });
        }

        // console.log(`   - Status actual: ${existingOrder.status}`);
        // console.log(`   - Email: ${existingOrder.customer_email}`);

        // 2. Obtener items del pedido
        const { data: orderItems, error: itemsError } = await supabaseAdmin.from("order_items").select("photo_id").eq(ORDER_FIELD_NAME, orderId);

        if (itemsError || !orderItems || orderItems.length === 0) {
            console.error("❌ No se encontraron items para esta orden:", itemsError);
            return res.status(500).json({ error: "Order items not found" });
        }

        // console.log(`   - Fotos en el pedido: ${orderItems.length}`);

        // 3. Obtener rutas de fotos originales
        const photoIds = orderItems.map((item) => item.photo_id);
        const { data: photos, error: photosError } = await supabaseAdmin.from("photos").select("original_file_path").in("id", photoIds);

        if (photosError || !photos || photos.length === 0) {
            console.error("❌ No se encontraron fotos:", photosError);
            return res.status(500).json({ error: "Photos not found" });
        }

        // console.log(`   - Fotos encontradas: ${photos.length}`);

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

        // console.log(`   ✓ Orden actualizada a 'paid'`);
        // console.log(`   - Payment ID simulado: ${simulatedPaymentId}`);
        // console.log(`   - Expira: ${expiresAt.toISOString()}`);

        // 5. Crear registro de descargas
        const { error: downloadError } = await supabaseAdmin.from("descargas").upsert(
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
            // console.log(`   ✓ Registro de descargas creado (contador: 0)`);
        }

        // console.log("\n✅ ===== SIMULACIÓN COMPLETADA =====\n");

        res.status(200).json({
            status: "simulated_success",
            orderId,
            customer_email: existingOrder.customer_email,
            photos: photos.length,
            expires_at: expiresAt.toISOString(),
            message: "Pago simulado exitosamente. La orden está lista para descarga.",
            success_url: `${process.env.BACKEND_URL}/success.html?order_id=${orderId}&customer_email=${existingOrder.customer_email}`,
        });
    } catch (error) {
        console.error("\n❌ Error en simulación de pago:", error);
        res.status(500).json({
            error: "Internal server error",
            details: error.message,
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
        // console.log(`✅ URL firmada generada para foto ${photoId}`);
        return res.redirect(signed.signedUrl);
    } catch (err) {
        console.error("❌ Error inesperado en la descarga de foto:", err);
        res.status(500).send("Error interno del servidor.");
    }
});

// --- Iniciar el servidor ---
app.listen(PORT, () => {
    // console.log(`Servidor backend escuchando en http://localhost:${PORT}`);
    // console.log("¡Listo para la acción con Supabase, Sharp y Mercado Pago Webhooks!");
});

app.get("/config.js", (req, res) => {
    res.setHeader("Content-Type", "application/javascript");
    // En desarrollo, usar localhost; en producción, usar BACKEND_URL del .env
    const backendUrl = process.env.NODE_ENV === "development" 
        ? `http://localhost:${process.env.PORT || 3000}`
        : process.env.BACKEND_URL;
    res.send(`window.BACKEND_URL = "${backendUrl}";`);
});

app.get("/orders", requireAuth, async (req, res) => {
    try {
        const photographerId = req.photographer.id;
        
        const { data, error } = await supabaseAdmin
            .from("orders")
            .select("*")
            .eq("photographer_id", photographerId)
            .order("created_at", { ascending: false });

        if (error) throw error;

        res.json({ orders: data });
    } catch (err) {
        console.error("Error al obtener pedidos:", err);
        res.status(500).json({ message: "Error interno al obtener pedidos" });
    }
});

// Eliminar todos los pedidos del fotógrafo (debe estar ANTES de /orders/:id)
app.delete("/orders/all", requireAuth, async (req, res) => {
    try {
        const photographerId = req.photographer.id;
        
        // Primero obtener todos los pedidos del fotógrafo
        const { data: orders, error: fetchError } = await supabaseAdmin
            .from("orders")
            .select("id")
            .eq("photographer_id", photographerId);

        if (fetchError) throw fetchError;

        // Si no hay pedidos, retornar
        if (!orders || orders.length === 0) {
            return res.json({ message: "No hay pedidos para eliminar" });
        }

        // Extraer todos los IDs de pedidos
        const orderIds = orders.map((order) => order.id);

        // Eliminar todos los order_items asociados
        const { error: itemsError } = await supabaseAdmin.from("order_items").delete().in("order_id", orderIds);

        if (itemsError) throw itemsError;

        // Eliminar todos los pedidos
        const { error: ordersError } = await supabaseAdmin.from("orders").delete().in("id", orderIds);

        if (ordersError) throw ordersError;

        res.json({ message: `${orders.length} pedidos eliminados exitosamente` });
    } catch (err) {
        console.error("Error al eliminar todos los pedidos:", err);
        res.status(500).json({ message: "Error al eliminar pedidos" });
    }
});

// Eliminar un pedido específico (MULTI-TENANT)
app.delete("/orders/:id", requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const photographerId = req.photographer.id;

        // Verificar que el pedido pertenece al fotógrafo
        const { data: order } = await supabaseAdmin
            .from("orders")
            .select("id")
            .eq("id", id)
            .eq("photographer_id", photographerId)
            .single();

        if (!order) {
            return res.status(404).json({ message: "Pedido no encontrado o no autorizado" });
        }

        // Eliminar order_items asociados primero
        const { error: itemsError } = await supabaseAdmin.from("order_items").delete().eq("order_id", id);

        if (itemsError) throw itemsError;

        // Eliminar el pedido
        const { error: orderError } = await supabaseAdmin.from("orders").delete().eq("id", id);

        if (orderError) throw orderError;

        res.json({ message: "Pedido eliminado exitosamente" });
    } catch (err) {
        console.error("Error al eliminar pedido:", err);
        res.status(500).json({ message: "Error al eliminar pedido" });
    }
});

app.get("/admin/stats", requireAuth, async (req, res) => {
    try {
        const photographerId = req.photographer.id;

        // Obtener conteos filtrados por photographer_id
        const [{ count: totalAlbums }, albumsWithPhotos, { count: totalOrders }, ordersData] = await Promise.all([
            supabaseAdmin.from("albums").select("*", { count: "exact", head: true }).eq("photographer_id", photographerId),
            supabaseAdmin.from("albums").select("id").eq("photographer_id", photographerId),
            supabaseAdmin.from("orders").select("*", { count: "exact", head: true }).eq("photographer_id", photographerId),
            supabaseAdmin.from("orders").select("total_amount, status").eq("photographer_id", photographerId),
        ]);

        // Contar fotos de todos los álbumes del fotógrafo
        const albumIds = albumsWithPhotos.data?.map((a) => a.id) || [];
        let totalPhotos = 0;
        if (albumIds.length > 0) {
            const { count } = await supabaseAdmin.from("photos").select("*", { count: "exact", head: true }).in("album_id", albumIds);
            totalPhotos = count ?? 0;
        }

        // Calcular ventas totales (solo pedidos pagados)
        const totalSales = ordersData.data
            ?.filter((order) => order.status === "paid")
            .reduce((sum, order) => sum + (order.total_amount || 0), 0) || 0;

        res.json({
            totalAlbums: totalAlbums ?? 0,
            totalPhotos,
            totalOrders: totalOrders ?? 0,
            totalSales: totalSales.toFixed(2),
            photographer: {
                business_name: req.photographer.business_name,
                plan_type: req.photographer.plan_type,
                subscription_status: req.photographer.subscription_status,
            },
        });
    } catch (err) {
        console.error("Error al obtener estadísticas:", err);
        res.status(500).json({ message: "Error interno al obtener estadísticas" });
    }
});

// Obtener álbumes con sus fotos (MULTI-TENANT)
app.get("/albums-with-photos", requireAuth, async (req, res) => {
    try {
        const photographerId = req.photographer.id;
        
        const { data: albums, error } = await supabaseAdmin
            .from("albums")
            .select(
                `
        id,
        name,
        event_date,
        description,
        price_per_photo,
        photos!photos_album_id_fkey (
          id,
          watermarked_file_path
        )
      `
            )
            .eq("photographer_id", photographerId)
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

// Eliminar álbum y fotos (MULTI-TENANT)
app.delete("/albums/:id", requireAuth, async (req, res) => {
    const { id } = req.params;
    const photographerId = req.photographer.id;
    
    try {
        // Verificar que el álbum pertenece al fotógrafo
        const { data: album } = await supabaseAdmin.from("albums").select("id").eq("id", id).eq("photographer_id", photographerId).single();
        
        if (!album) {
            return res.status(404).json({ message: "Álbum no encontrado o no autorizado" });
        }
        
        await supabaseAdmin.from("photos").delete().eq("album_id", id);
        const { error } = await supabaseAdmin.from("albums").delete().eq("id", id).eq("photographer_id", photographerId);
        if (error) throw error;
        res.json({ message: "Álbum eliminado" });
    } catch (err) {
        console.error("Error al eliminar álbum:", err);
        res.status(500).json({ message: "Error interno al eliminar álbum" });
    }
});

// Eliminar foto (MULTI-TENANT)
app.delete("/photos/:id", requireAuth, async (req, res) => {
    const { id } = req.params;
    const photographerId = req.photographer.id;
    
    try {
        // Verificar que la foto pertenece a un álbum del fotógrafo
        const { data: photo } = await supabaseAdmin
            .from("photos")
            .select("id, album_id, albums!inner(photographer_id)")
            .eq("id", id)
            .single();
        
        if (!photo || photo.albums.photographer_id !== photographerId) {
            return res.status(404).json({ message: "Foto no encontrada o no autorizada" });
        }
        
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
    const { name, event_date, description, price_per_photo } = req.body;

    try {
        const updateData = {
            name,
            event_date,
            description,
        };

        // Solo actualizar precio si se proporciona
        if (price_per_photo !== undefined) {
            updateData.price_per_photo = Number(price_per_photo);

            // Actualizar el precio de todas las fotos existentes en este álbum
            const { error: photosError } = await supabaseAdmin
                .from("photos")
                .update({ price: Number(price_per_photo) })
                .eq("album_id", id);

            if (photosError) {
                console.error("Error al actualizar precios de fotos:", photosError);
            } else {
                // console.log(`✓ Precios actualizados para todas las fotos del álbum ${id}: $${price_per_photo}`);
            }
        }

        const { data, error } = await supabaseAdmin.from("albums").update(updateData).eq("id", id).select().single();

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

// ===== ENDPOINTS DE MONITOREO Y DEBUGGING =====

// Obtener logs del buffer
app.get("/api/monitoring/logs", (req, res) => {
    const { level, limit = 100 } = req.query;

    let logs = [...logBuffer];

    // Filtrar por nivel si se especifica
    if (level && level.toUpperCase() !== "ALL") {
        logs = logs.filter((log) => log.level === level.toUpperCase());
    }

    // Limitar cantidad
    logs = logs.slice(-parseInt(limit));

    res.json({
        total: logs.length,
        logs: logs.reverse(), // Más recientes primero
    });
});

// Limpiar logs
app.delete("/api/monitoring/logs", (req, res) => {
    const count = logBuffer.length;
    logBuffer.length = 0;
    logger.info("Logs limpiados manualmente", { count });
    res.json({ message: `${count} logs eliminados` });
});

// Configurar nivel de log
app.post("/api/monitoring/log-level", (req, res) => {
    const { level } = req.body;

    if (!LOG_LEVELS[level.toUpperCase()]) {
        return res.status(400).json({ error: "Nivel inválido. Usa: DEBUG, INFO, WARN, ERROR" });
    }

    currentLogLevel = level.toUpperCase();
    logger.info(`Nivel de log cambiado a ${currentLogLevel}`);

    res.json({ level: currentLogLevel });
});

// Habilitar/deshabilitar logs en consola
app.post("/api/monitoring/console-logging", (req, res) => {
    const { enabled } = req.body;
    consoleLoggingEnabled = enabled;
    logger.info(`Console logging ${enabled ? "habilitado" : "deshabilitado"}`);
    res.json({ consoleLoggingEnabled });
});

// Obtener métricas
app.get("/api/monitoring/metrics", (req, res) => {
    const uptime = Date.now() - metrics.startTime;
    const avgResponseTime = metrics.responseTimes.length > 0 ? metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length : 0;

    res.json({
        uptime: {
            ms: uptime,
            formatted: formatUptime(uptime),
        },
        requests: metrics.requests,
        errors: metrics.errors,
        photos: metrics.photos,
        albums: metrics.albums,
        orders: metrics.orders,
        performance: {
            avgResponseTime: Math.round(avgResponseTime),
            minResponseTime: Math.min(...metrics.responseTimes),
            maxResponseTime: Math.max(...metrics.responseTimes),
        },
        system: {
            nodeVersion: process.version,
            platform: process.platform,
            memory: process.memoryUsage(),
        },
        config: {
            logLevel: currentLogLevel,
            consoleLoggingEnabled,
        },
    });
});

// Resetear métricas
app.delete("/api/monitoring/metrics", (req, res) => {
    metrics.requests = { total: 0, byEndpoint: {}, byStatusCode: {} };
    metrics.errors = { total: 0, byType: {} };
    metrics.photos = { uploaded: 0, downloaded: 0 };
    metrics.albums = { created: 0 };
    metrics.orders = { created: 0, paid: 0 };
    metrics.responseTimes = [];

    logger.info("Métricas reseteadas");
    res.json({ message: "Métricas reseteadas" });
});

// Health check
app.get("/api/monitoring/health", async (req, res) => {
    const checks = {
        server: "ok",
        database: "checking",
        storage: "checking",
    };

    try {
        // Test database
        const { error: dbError } = await supabaseAdmin.from("albums").select("id").limit(1);
        checks.database = dbError ? "error" : "ok";

        // Test storage
        const { data: buckets, error: storageError } = await supabaseAdmin.storage.listBuckets();
        checks.storage = storageError ? "error" : "ok";

        const allOk = Object.values(checks).every((status) => status === "ok");

        res.status(allOk ? 200 : 503).json({
            status: allOk ? "healthy" : "degraded",
            checks,
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        logger.error("Health check failed", { error: err.message });
        res.status(503).json({
            status: "unhealthy",
            checks,
            error: err.message,
        });
    }
});

// ===== ENDPOINTS DE TESTING =====

// Test de creación de álbum
app.post("/api/testing/create-test-album", async (req, res) => {
    try {
        const testAlbum = {
            name: `Test Album ${Date.now()}`,
            event_date: new Date().toISOString().split("T")[0],
            description: "Álbum de prueba generado automáticamente",
            price_per_photo: 50,
            photographer_user_id: "65805569-2e32-46a0-97c5-c52e31e02866",
        };

        const { data, error } = await supabaseAdmin.from("albums").insert(testAlbum).select().single();

        if (error) throw error;

        metrics.albums.created++;
        logger.info("Test album created", { albumId: data.id });

        res.json({ success: true, album: data });
    } catch (err) {
        logger.error("Failed to create test album", { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

// Limpiar datos de prueba
app.delete("/api/testing/cleanup-test-data", async (req, res) => {
    try {
        // Eliminar álbumes de prueba (que contengan "Test" en el nombre)
        const { data: testAlbums } = await supabaseAdmin.from("albums").select("id").ilike("name", "%test%");

        if (testAlbums && testAlbums.length > 0) {
            const albumIds = testAlbums.map((a) => a.id);

            // Eliminar fotos de álbumes de prueba
            await supabaseAdmin.from("photos").delete().in("album_id", albumIds);

            // Eliminar álbumes
            await supabaseAdmin.from("albums").delete().in("id", albumIds);
        }

        logger.info("Test data cleaned up", { albumsDeleted: testAlbums?.length || 0 });

        res.json({
            success: true,
            deleted: {
                albums: testAlbums?.length || 0,
            },
        });
    } catch (err) {
        logger.error("Failed to cleanup test data", { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

// Simular error para testing
app.get("/api/testing/simulate-error", (req, res) => {
    const errorType = req.query.type || "500";

    metrics.errors.total++;
    metrics.errors.byType[errorType] = (metrics.errors.byType[errorType] || 0) + 1;

    logger.error(`Simulated error: ${errorType}`);

    switch (errorType) {
        case "400":
            res.status(400).json({ error: "Bad Request (simulado)" });
            break;
        case "404":
            res.status(404).json({ error: "Not Found (simulado)" });
            break;
        case "500":
        default:
            res.status(500).json({ error: "Internal Server Error (simulado)" });
    }
});

// Test de performance (respuesta lenta)
app.get("/api/testing/slow-endpoint", async (req, res) => {
    const delay = parseInt(req.query.delay) || 3000;
    logger.warn(`Slow endpoint called with ${delay}ms delay`);

    await new Promise((resolve) => setTimeout(resolve, delay));

    res.json({
        message: "Respuesta retrasada completada",
        delay: `${delay}ms`,
    });
});

// Función helper para formatear uptime
function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

// ===== FIN DE ENDPOINTS DE MONITOREO =====
