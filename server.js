// server.js

// Carga las variables de entorno al inicio de todo
require('dotenv').config();

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const sharp = require('sharp'); // Para el procesamiento de imágenes
const path = require('path');   // Para manejar rutas de archivos
const fs = require('fs');       // Para verificar si la marca de agua existe (opcional, pero buena práctica)
const mercadopago = require('mercadopago'); // Importa el módulo completo de mercadopago
const cors = require('cors'); // Importa el módulo CORS

const app = express();
const PORT = process.env.PORT || 3000;

// --- Configuración de Supabase ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Verificación de todas las variables de entorno necesarias
if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    console.error('Error: Asegúrate de que SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY estén definidas en el archivo .env.');
    process.exit(1); // Sale de la aplicación si falta alguna
}

// Cliente Supabase para operaciones generales (login de usuarios, lectura de datos públicos)
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Cliente Supabase con rol de servicio (para operaciones administrativas y escritura en buckets privados)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

// Crea una instancia del cliente de Mercado Pago con tu Access Token
const client = new mercadopago.MercadoPagoConfig({
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
});

// LOG PARA DEPURACIÓN: Muestra el token completo al iniciar
console.log('MP Access Token siendo utilizado por el cliente:', process.env.MERCADOPAGO_ACCESS_TOKEN);
// FIN LOG

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

            const orderData = await response.json();

            // Si la orden tiene pagos, la devolvemos
            if (orderData && orderData.payments && orderData.payments.length > 0) {
                return orderData;
            }

            // Si no tiene pagos y no es el último intento, esperamos y reintentamos
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
        await new Promise(res => setTimeout(res, 3000));
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
app.use(express.static('public'));

// Configuración de Multer para la subida de archivos
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 25 * 1024 * 1024 }, // Limite de 25MB por archivo, ajusta según necesidad
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten archivos de imagen.'), false);
        }
    }
});

// --- Rutas ---

// Ruta de prueba para verificar que el servidor está funcionando
app.get('/', (req, res) => {
    res.send('Backend de la Plataforma de Fotos Escolares funcionando!');
});

// Ruta de prueba para verificar la conexión a Supabase
app.get('/test-supabase', async (req, res) => {
    try {
        // Usamos supabaseAdmin para asegurarnos de que la conexión de servicio funciona
        const { data, error } = await supabaseAdmin.from('albums').select('*').limit(1);

        if (error) {
            console.error('Error al probar Supabase:', error);
            return res.status(500).json({ message: 'Error al conectar con Supabase', error: error.message });
        }
        res.status(200).json({ message: 'Conexión a Supabase exitosa. Datos de álbumes (si hay):', data });
    } catch (err) {
        console.error('Error inesperado en /test-supabase:', err);
        res.status(500).json({ message: 'Error inesperado del servidor' });
    }
});

// --- NUEVAS RUTAS: Gestión de Álbumes ---

// Ruta para obtener todos los álbumes (para el dropdown en el admin)
app.get('/albums', async (req, res) => {
    try {
        // En un sistema real, aquí verificarías la autenticación del fotógrafo
        // const { data: user } = await supabase.auth.getUser();
        // if (!user) return res.status(401).json({ message: 'No autorizado.' });

        // Usamos supabaseAdmin para obtener todos los álbumes sin restricciones RLS
        const { data: albums, error } = await supabaseAdmin.from('albums').select('id, name');

        if (error) {
            console.error('Error al obtener álbumes:', error.message);
            return res.status(500).json({ message: `Error al obtener álbumes: ${error.message}` });
        }
        res.status(200).json({ message: 'Álbumes obtenidos exitosamente.', albums });
    } catch (err) {
        console.error('Error inesperado al obtener álbumes:', err);
        res.status(500).json({ message: 'Error interno del servidor al obtener álbumes.' });
    }
});

// Ruta para crear un nuevo álbum
app.post('/albums', async (req, res) => {
    const { name, event_date } = req.body; // Asegúrate de recibir event_date del frontend
    // En un sistema real, el photographer_user_id vendría de la sesión del usuario logueado
    const photographer_user_id = '65805569-2e32-46a0-97c5-c52e31e02866'; // <-- ¡IMPORTANTE! Usar el ID real del fotógrafo logueado

    if (!name) {
        return res.status(400).json({ message: 'El nombre del álbum es requerido.' });
    }
    // Validar event_date si es requerido por la BD
    if (!event_date) {
        return res.status(400).json({ message: 'La fecha del evento es requerida para el álbum.' });
    }

    // *** LOG PARA DEPURACIÓN: Muestra los datos que se intentan insertar ***
    console.log('Intentando crear álbum con datos:', { name, event_date, photographer_user_id });
    // *** FIN LOG ***

    try {
        const { data: album, error } = await supabaseAdmin
            .from('albums')
            .insert({ name, event_date, photographer_user_id }) // Incluye event_date aquí
            .select()
            .single();

        if (error) {
            console.error('Error al crear álbum:', error.message);
            return res.status(500).json({ message: `Error al crear álbum: ${error.message}` });
        }
        res.status(201).json({ message: 'Álbum creado exitosamente.', album });
    } catch (err) {
        console.error('Error inesperado al crear álbum:', err);
        res.status(500).json({ message: 'Error interno del servidor al crear álbum.' });
    }
});


// Ruta para obtener fotos de un álbum específico (para el cliente)
app.get('/albums/:albumId/photos', async (req, res) => {
    const albumId = req.params.albumId;

    if (!albumId || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(albumId)) {
        return res.status(400).json({ message: 'ID de álbum no válido.' });
    }

    try {
        const { data: photos, error } = await supabaseAdmin
            .from('photos')
            .select('id, watermarked_file_path, student_code, price, metadata')
            .eq('album_id', albumId);

        if (error) {
            console.error('Error al obtener fotos del álbum:', error.message);
            return res.status(500).json({ message: `Error al obtener fotos: ${error.message}` });
        }

        if (!photos || photos.length === 0) {
            return res.status(404).json({ message: 'No se encontraron fotos para este álbum.' });
        }

        const photosWithPublicUrls = photos.map(photo => ({
            ...photo,
            public_watermarked_url: `${supabaseUrl}/storage/v1/object/public/watermarked-photos/${photo.watermarked_file_path}`
        }));

        res.status(200).json({
            message: `Fotos obtenidas exitosamente para el álbum ${albumId}.`,
            photos: photosWithPublicUrls
        });

    } catch (err) {
        console.error('Error inesperado al obtener fotos:', err);
        res.status(500).json({ message: 'Error inesperado del servidor' });
    }
});

// Ruta de login para fotógrafos
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email y contraseña son requeridos.' });
    }

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });

        if (error) {
            console.error('Error de autenticación:', error.message);
            if (error.message.includes('Invalid login credentials')) {
                return res.status(401).json({ message: 'Credenciales inválidas. Por favor, verifica tu email y contraseña.' });
            }
            return res.status(500).json({ message: `Error al iniciar sesión: ${error.message}` });
        }

        res.status(200).json({
            message: 'Inicio de sesión exitoso.',
            user: data.user,
            session: data.session
        });

    } catch (err) {
        console.error('Error inesperado en el login:', err);
        res.status(500).json({ message: 'Error interno del servidor al intentar iniciar sesión.' });
    }
});

// Ruta para crear una preferencia de pago en Mercado Pago
app.post('/create-payment-preference', async (req, res) => {
    const { cart, customerEmail } = req.body;

    if (!cart || cart.length === 0 || !customerEmail) {
        return res.status(400).json({ message: 'El carrito está vacío o el email del cliente no fue proporcionado.' });
    }

    let totalAmount = 0;
    const itemsMP = cart.map(item => {
        totalAmount += item.price * item.quantity;
        return {
            title: `Foto ID: ${item.photoId.substring(0, 8)} - Código: ${item.studentCode || 'N/A'}`,
            unit_price: parseFloat(item.price),
            quantity: 1,
            currency_id: 'ARS',
            picture_url: item.watermarkedUrl
        };
    });

    try {
        // 1. Crear el pedido en tu base de datos (Supabase)
        const { data: orderData, error: orderError } = await supabaseAdmin
            .from('orders')
            .insert({
                customer_email: customerEmail,
                total_amount: totalAmount,
                status: 'pending',
            })
            .select()
            .single();

        if (orderError) {
            console.error('Error al crear el pedido en Supabase:', orderError.message);
            return res.status(500).json({ message: `Error al crear el pedido: ${orderError.message}` });
        }

        // 2. Insertar los ítems del pedido
        const orderItemsToInsert = cart.map(item => ({
            order_id: orderData.id,
            photo_id: item.photoId,
            price_at_purchase: item.price,
            quantity: item.quantity
        }));

        const { error: orderItemsError } = await supabaseAdmin
            .from('order_items')
            .insert(orderItemsToInsert);

        if (orderItemsError) {
            console.error('Error al insertar ítems del pedido en Supabase:', orderItemsError.message);
            return res.status(500).json({ message: `Error al insertar ítems del pedido: ${orderItemsError.message}` });
        }

        // 3. Crear la preferencia de pago en Mercado Pago
        const simplePreferenceData = {
            items: [
                {
                    title: "Compra de Fotos Escolares",
                    unit_price: parseFloat(totalAmount),
                    quantity: 1,
                    currency_id: 'ARS',
                }
            ],
            external_reference: orderData.id,
            // Todas las back_urls apuntan a success.html para un flujo unificado
            back_urls: {
                success: `${process.env.FRONTEND_URL}/success.html?orderId=${orderData.id}&customerEmail=${encodeURIComponent(customerEmail)}`,
                failure: `${process.env.FRONTEND_URL}/success.html?orderId=${orderData.id}&customerEmail=${encodeURIComponent(customerEmail)}`, // Redirige a success también en caso de falla
                pending: `${process.env.FRONTEND_URL}/success.html?orderId=${orderData.id}&customerEmail=${encodeURIComponent(customerEmail)}` // Redirige a success también en caso de pendiente
            },
            notification_url: `${process.env.BACKEND_URL}/mercadopago-webhook`
        };

        const responseMP = await preference.create({ body: simplePreferenceData });
        
        console.log('Respuesta COMPLETA de Mercado Pago (para depuración):', JSON.stringify(responseMP, null, 2));

        const redirectUrl = process.env.NODE_ENV === 'production' 
                            ? responseMP.init_point 
                            : responseMP.sandbox_init_point;
        
        res.status(200).json({
            message: 'Preferencia de pago creada exitosamente.',
            init_point: redirectUrl,
            payment_id: responseMP.id,
            orderId: orderData.id
        });

    } catch (err) {
        console.error('Error al crear preferencia de pago en Mercado Pago (catch):', err);
        res.status(500).json({ message: 'Error interno del servidor al crear preferencia de pago.' });
    }
});

app.post('/upload-photos/:albumId', upload.array('photos'), async (req, res) => {
    const albumId = req.params.albumId;
    const photographerId = '65805569-2e32-46a0-97c5-c52e31e02866'; // <-- tu ID fijo por ahora

    if (!albumId || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(albumId)) {
        return res.status(400).json({ message: 'ID de álbum no válido.' });
    }

    try {
        const { data: album, error: albumError } = await supabaseAdmin
            .from('albums')
            .select('id, photographer_user_id')
            .eq('id', albumId)
            .eq('photographer_user_id', photographerId)
            .single();

        if (albumError || !album) {
            console.error('Error al verificar álbum:', albumError ? albumError.message : 'Álbum no encontrado.');
            return res.status(404).json({ message: 'Álbum no encontrado o no autorizado para este fotógrafo.' });
        }
    } catch (dbError) {
        console.error('Error de base de datos al verificar álbum:', dbError);
        return res.status(500).json({ message: 'Error interno del servidor al verificar el álbum.' });
    }

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'No se subieron archivos.' });
    }

    const watermarkedPhotosPath = path.resolve(__dirname, 'assets', 'watermark.png');
    console.log('Intentando cargar marca de agua desde:', watermarkedPhotosPath);
    if (!fs.existsSync(watermarkedPhotosPath)) {
        console.error(`Error: Archivo de marca de agua no encontrado en ${watermarkedPhotosPath}`);
        return res.status(500).json({ message: 'Error interno: Archivo de marca de agua no encontrado.' });
    }

    const results = [];

    for (const file of req.files) {
        try {
            const uniqueFileName = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}${path.extname(file.originalname)}`;
            const originalFilePath = `albums/${albumId}/original/${uniqueFileName}`;
            const watermarkedFilePath = `albums/${albumId}/watermarked/${uniqueFileName}`;

            // Subir imagen original
            const { error: uploadOriginalError } = await supabaseAdmin.storage
                .from('original-photos')
                .upload(originalFilePath, file.buffer, {
                    contentType: file.mimetype,
                    upsert: false
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
                        gravity: 'center',
                    }
                ])
                .toFormat('jpeg', { quality: 80 })
                .toBuffer();

            // Subir imagen con marca de agua
            const { error: uploadWatermarkedError } = await supabaseAdmin.storage
                .from('watermarked-photos')
                .upload(watermarkedFilePath, watermarkedBuffer, {
                    contentType: 'image/jpeg',
                    upsert: false
                });

            if (uploadWatermarkedError) {
                console.error(`Error al subir la imagen con marca de agua "${file.originalname}":`, uploadWatermarkedError.message);
                throw new Error(`Fallo al subir marcada de agua: ${uploadWatermarkedError.message}`);
            }

            const publicWatermarkedUrl = `${supabaseUrl}/storage/v1/object/public/watermarked-photos/${watermarkedFilePath}`;

            const { data: photoDbData, error: dbInsertError } = await supabaseAdmin
                .from('photos')
                .insert([{
                    album_id: albumId,
                    original_file_path: originalFilePath,
                    watermarked_file_path: watermarkedFilePath,
                    student_code: null,
                    price: 15.00,
                    metadata: {
                        originalName: file.originalname,
                        mimetype: file.mimetype,
                        size: file.size
                    }
                }])
                .select()
                .single();

            if (dbInsertError) {
                console.error(`Error al insertar en la BD para "${file.originalname}":`, dbInsertError.message);
                throw new Error(`Fallo al guardar en la BD: ${dbInsertError.message}`);
            }

            results.push({
                originalName: file.originalname,
                status: 'success',
                photoId: photoDbData.id,
                publicWatermarkedUrl: publicWatermarkedUrl
            });

        } catch (error) {
            console.error(`Error procesando o subiendo "${file.originalname}":`, error.message);
            results.push({
                originalName: file.originalname,
                status: 'failed',
                error: error.message
            });
        }
    }

    res.status(200).json({
        message: 'Proceso de subida de fotos completado.',
        summary: results.length > 0 ? `${results.filter(r => r.status === 'success').length} fotos subidas con éxito, ${results.filter(r => r.status === 'failed').length} fallidas.` : 'No se procesaron fotos.',
        results: results
    });
});


// --- NUEVA RUTA: Webhook de Mercado Pago ---
app.post('/mercadopago-webhook', async (req, res) => {
  console.log('--- Webhook de Mercado Pago recibido ---');
  console.log('Query Params:', req.query);
  console.log('Cuerpo del Webhook (JSON):', req.body);

  const { topic, id: merchantOrderId } = req.query;

  // Respondemos rápido a Mercado Pago para evitar reintentos
  res.status(200).send('OK');

  if (topic !== 'merchant_order') {
    console.log('Ignorando webhook que no es de tipo merchant_order');
    return;
  }

  try {
    // Usamos retry inteligente
    const orderData = await getMerchantOrderWithRetry(merchantOrderId);

    if (!orderData || !orderData.external_reference) {
      console.error('Orden inválida o sin external_reference');
      return;
    }

    const orderId = orderData.external_reference;
    const payments = orderData.payments;

    if (!payments || payments.length === 0) {
      console.warn(`⚠️ Orden ${orderId} no tiene pagos después de reintentos.`);
      return;
    }

    const latestPayment = payments[0];
    const paymentStatus = latestPayment.status;
    const paymentIdMP = latestPayment.id;

    let newStatus;
    switch (paymentStatus) {
      case 'approved':
        newStatus = 'paid';
        break;
      case 'pending':
        newStatus = 'pending_payment';
        break;
      case 'rejected':
        newStatus = 'rejected';
        break;
      default:
        newStatus = 'unknown';
    }

    const { error: updateError } = await supabaseAdmin
      .from('orders')
      .update({
        status: newStatus,
        mp_payment_id: paymentIdMP,
        mp_status: paymentStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    if (updateError) {
      console.error(`❌ Error actualizando orden ${orderId}:`, updateError.message);
      return;
    }

    console.log(`✅ Orden ${orderId} actualizada con estado: ${newStatus}`);

    if (newStatus === 'paid') {
      console.log(`🎉 Pago confirmado. Ahora podés habilitar descarga, etc.`);
    }

  } catch (err) {
    console.error('❌ Error al procesar merchant_order con retry:', err);
  }
});

// --- NUEVA RUTA: Obtener Detalles de Orden para Página de Éxito ---
// Esta ruta es llamada por success.html para obtener las fotos compradas.
app.get('/order-details/:orderId/:customerEmail', async (req, res) => {
    const { orderId, customerEmail } = req.params;

    if (!orderId || !customerEmail) {
        return res.status(400).json({ message: 'ID de orden o email del cliente faltantes.' });
    }
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(orderId)) {
        return res.status(400).json({ message: 'ID de orden no válido.' });
    }

    try {
        // 1. Verificar que la orden existe, está pagada y pertenece a este email
        // Usamos supabaseAdmin para ignorar RLS en esta verificación de backend
        const { data: order, error: orderError } = await supabaseAdmin
            .from('orders')
            .select('id, customer_email, status')
            .eq('id', orderId)
            .eq('customer_email', customerEmail)
            // No verificamos el status 'paid' aquí para que la página de éxito pueda mostrar
            // estados pendientes o rechazados. success.html debe manejar esto.
            .single();

        if (orderError || !order) {
            console.error(`Error al obtener detalles de orden: Orden ${orderId} no encontrada o email incorrecto.`, orderError?.message);
            // Devolvemos un 404/403 pero con un mensaje que success.html pueda interpretar
            return res.status(404).json({ message: 'Orden no encontrada o email no coincide.', status: 'not_found' });
        }

        // Si la orden no está pagada, devolvemos el estado actual para que el frontend lo maneje
        if (order.status !== 'paid') {
            return res.status(200).json({
                message: `La orden ${orderId} no está pagada aún. Estado actual: ${order.status}`,
                order: {
                    id: order.id,
                    customer_email: order.customer_email,
                    status: order.status
                },
                photos: [] // No enviamos fotos si no está pagada
            });
        }

        // 2. Obtener los ítems (fotos) asociados a esta orden
        // Usamos supabaseAdmin para ignorar RLS en esta verificación de backend
        const { data: orderItems, error: orderItemsError } = await supabaseAdmin
            .from('order_items')
            .select('photo_id')
            .eq('order_id', orderId);

        if (orderItemsError) {
            console.error(`Error al obtener ítems de la orden ${orderId}:`, orderItemsError.message);
            return res.status(500).json({ message: 'Error al obtener ítems de la orden.' });
        }

        if (!orderItems || orderItems.length === 0) {
            return res.status(404).json({ message: 'No se encontraron fotos para esta orden.' });
        }

        // 3. Obtener los detalles de cada foto (especialmente la URL con marca de agua y student_code)
        // Usamos supabaseAdmin para ignorar RLS en esta verificación de backend
        const { data: photos, error: photosError } = await supabaseAdmin
            .from('photos')
            .select('id, watermarked_file_path, student_code, price') // Seleccionamos lo que necesitamos para mostrar
            .in('id', photoIds);

        if (photosError) {
            console.error(`Error al obtener detalles de las fotos para la orden ${orderId}:`, photosError.message);
            return res.status(500).json({ message: 'Error al obtener detalles de las fotos.' });
        }

        const photosWithPublicUrls = photos.map(photo => ({
            id: photo.id,
            student_code: photo.student_code,
            price: photo.price,
            // Construimos la URL pública de la foto con marca de agua
            watermarked_url: `${supabaseUrl}/storage/v1/object/public/watermarked-photos/${photo.watermarked_file_path}`
        }));

        res.status(200).json({
            message: `Detalles de la orden ${orderId} obtenidos exitosamente.`,
            order: {
                id: order.id,
                customer_email: order.customer_email,
                status: order.status
            },
            photos: photosWithPublicUrls
        });

    } catch (err) {
        console.error('❌ Error inesperado en la ruta /order-details:', err);
        res.status(500).json({ message: 'Error interno del servidor al obtener detalles de la orden.' });
    }
});


// --- NUEVA RUTA: Descarga de Fotos Originales ---
// Esta ruta es para que el cliente descargue la foto original después de pagar.
// Necesitará algún tipo de autenticación (ej. un token temporal, o que el usuario esté logueado
// y se verifique su compra). Por ahora, una verificación simple por orderId y customerEmail.
app.get('/download-photo/:photoId/:orderId/:customerEmail', async (req, res) => {
    const { photoId, orderId, customerEmail } = req.params;

    // 1. Validar IDs
    if (!photoId || !orderId || !customerEmail) {
        return res.status(400).send('Faltan parámetros de descarga.');
    }
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(photoId) ||
        !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(orderId)) {
        return res.status(400).send('IDs de foto u orden no válidos.');
    }

    try {
        // 2. Verificar que la orden existe, está pagada y pertenece a este email
        // Usamos supabaseAdmin para ignorar RLS en esta verificación de backend
        const { data: order, error: orderError } = await supabaseAdmin
            .from('orders')
            .select('id, customer_email, status')
            .eq('id', orderId)
            .eq('customer_email', customerEmail)
            .eq('status', 'paid') // Solo si el estado es 'paid'
            .single();

        if (orderError || !order) {
            console.error(`Error de autorización para descarga: Orden ${orderId} no encontrada, no pagada o email incorrecto.`, orderError?.message);
            return res.status(403).send('No autorizado para descargar esta foto. La orden no existe, no está pagada o el email no coincide.');
        }

        // 3. Verificar que la foto es parte de esta orden
        // Usamos supabaseAdmin para ignorar RLS en esta verificación de backend
        const { data: orderItem, error: orderItemError } = await supabaseAdmin
            .from('order_items')
            .select('id, photo_id')
            .eq('order_id', orderId)
            .eq('photo_id', photoId)
            .single();

        if (orderItemError || !orderItem) {
            console.error(`Error de autorización para descarga: Foto ${photoId} no encontrada en la orden ${orderId}.`, orderItemError?.message);
            return res.status(403).send('La foto no es parte de esta orden.');
        }

        // 4. Obtener la ruta del archivo original de la foto
        // Usamos supabaseAdmin para ignorar RLS en esta verificación de backend
        const { data: photo, error: photoError } = await supabaseAdmin
            .from('photos')
            .select('original_file_path')
            .eq('id', photoId)
            .single();

        if (photoError || !photo || !photo.original_file_path) {
            console.error(`Error al obtener ruta de archivo original para foto ${photoId}:`, photoError?.message);
            return res.status(404).send('Ruta de archivo original no encontrada para la foto.');
        }

        // 5. Descargar el archivo original del bucket privado de Supabase
        const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage
            .from('original-photos') // Tu bucket privado
            .download(photo.original_file_path);

        if (downloadError) {
            console.error(`Error al descargar archivo original ${photo.original_file_path}:`, downloadError.message);
            return res.status(500).send('Error al descargar la foto original.');
        }

        // 6. Enviar el archivo al cliente
        // El nombre del archivo para la descarga
        const fileName = path.basename(photo.original_file_path);
        
        // Convertir Blob a Buffer para enviar con Express
        const buffer = Buffer.from(await fileBlob.arrayBuffer());

        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Type', fileBlob.type || 'application/octet-stream'); // Usar el tipo de archivo del blob
        res.send(buffer);

        console.log(`✅ Foto ${photoId} descargada exitosamente para la orden ${orderId}.`);

    } catch (err) {
        console.error('❌ Error inesperado en la ruta de descarga:', err);
        res.status(500).send('Error interno del servidor al procesar la descarga.');
    }
});


// --- Iniciar el servidor ---
app.listen(PORT, () => {
    console.log(`Servidor backend escuchando en http://localhost:${PORT}`);
    console.log('¡Listo para la acción con Supabase, Sharp y Mercado Pago Webhooks!');
});

app.get('/config.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`const BACKEND_URL = "${process.env.BACKEND_URL}";`);
});
