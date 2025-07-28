// server.js

// Carga las variables de entorno al inicio de todo
require('dotenv').config();

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const sharp = require('sharp'); // Para el procesamiento de imágenes
const path = require('path');   // Para manejar rutas de archivos
const fs = require('fs');       // Para verificar si la marca de agua existe (opcional, pero buena práctica)
const { MercadoPagoConfig, Preference } = require('mercadopago'); // <-- ¡MODIFICA ESTA LÍNEA!

const app = express();
const PORT = process.env.PORT || 3000;

// --- Configuración de Supabase ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY; // <-- ¡ESTA ES LA NUEVA LÍNEA!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Verificación de todas las variables de entorno necesarias
if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    console.error('Error: Asegúrate de que SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY estén definidas en el archivo .env.');
    process.exit(1); // Sale de la aplicación si falta alguna
}

// Cliente Supabase para operaciones generales (login de usuarios, lectura de datos públicos)
const supabase = createClient(supabaseUrl, supabaseAnonKey); // <-- ¡AHORA USA supabaseAnonKey!

// Cliente Supabase con rol de servicio (para operaciones administrativas y escritura en buckets privados)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey); // <-- ¡ESTE ES EL NUEVO CLIENTE!

// Crea una instancia del cliente de Mercado Pago con tu Access Token
const client = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN });
// También inicializa la clase Preference (para crear pagos) con este cliente
const preference = new Preference(client);

// --- Middlewares ---
app.use(express.json()); // Para parsear cuerpos de petición JSON
app.use(express.urlencoded({ extended: true })); // Para parsear datos de formularios URL-encoded

// Sirve los archivos estáticos desde la carpeta 'public'
app.use(express.static('public')); // <-- ¡Añade esta línea!

// Configuración de Multer para la subida de archivos
// Guarda el archivo en memoria como un Buffer, lo cual es ideal para procesar con Sharp
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 25 * 1024 * 1024 }, // Limite de 25MB por archivo, ajusta según necesidad
    fileFilter: (req, file, cb) => {
        // Aceptar solo imágenes
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
        // Intenta seleccionar de la tabla 'albums'. Esto confirmará la conexión a la DB.
        const { data, error } = await supabase.from('albums').select('*').limit(1);

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

// Ruta para obtener fotos de un álbum específico
app.get('/albums/:albumId/photos', async (req, res) => {
    const albumId = req.params.albumId;

    // 1. Validar el ID del álbum
    if (!albumId || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(albumId)) {
        return res.status(400).json({ message: 'ID de álbum no válido.' });
    }

    try {
        // 2. Obtener las fotos del álbum desde la base de datos
        // Usamos el cliente 'supabase' (con anon key) ya que esta es una operación de lectura pública
        // (asumiendo que tus políticas RLS en la tabla 'photos' permiten la lectura pública
        // o la lectura por código de estudiante/álbum).
        const { data: photos, error } = await supabase
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

        // 3. Construir las URLs públicas completas para las imágenes con marca de agua
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
        res.status(500).json({ message: 'Error interno del servidor al intentar obtener fotos.' });
    }
});

// Ruta de login para fotógrafos
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email y contraseña son requeridos.' });
    }

    try {
        // Usamos el cliente 'supabase' (con anon key) para autenticar usuarios
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
    const { cart, customerEmail } = req.body; // Recibe el carrito y el email del cliente

    if (!cart || cart.length === 0 || !customerEmail) {
        return res.status(400).json({ message: 'El carrito está vacío o el email del cliente no fue proporcionado.' });
    }

    // Calcula el total y prepara los items para Mercado Pago
    // NOTA: Para esta prueba con preferenceData simplificada, estos ítems no se usarán directamente en MP,
    // pero son necesarios para la creación de la orden en Supabase.
    let totalAmount = 0;
    const itemsMP = cart.map(item => { // Se sigue mapeando para tener la data si MP funciona.
        totalAmount += item.price * item.quantity;
        return {
            title: `Foto ID: ${item.photoId.substring(0, 8)} - Código: ${item.studentCode || 'N/A'}`,
            unit_price: parseFloat(item.price),
            quantity: item.quantity,
            currency_id: 'ARS',
            picture_url: item.watermarkedUrl
        };
    });

    try {
        // 1. Crear el pedido en tu base de datos (Supabase)
        // Por ahora, lo creamos con status 'pending'. Se actualizará a 'paid' vía webhook.
        const { data: orderData, error: orderError } = await supabaseAdmin
            .from('orders') // Usamos supabaseAdmin para insertar en la tabla de órdenes
            .insert({
                customer_email: customerEmail,
                total_amount: totalAmount, // Usamos el total real del carrito
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
            .from('order_items') // Usamos supabaseAdmin para insertar los ítems
            .insert(orderItemsToInsert);

        if (orderItemsError) {
            console.error('Error al insertar ítems del pedido en Supabase:', orderItemsError.message);
            // Si esto falla, podrías considerar borrar el 'order' que acabas de crear.
            return res.status(500).json({ message: `Error al insertar ítems del pedido: ${orderItemsError.message}` });
        }

        // 3. Crear la preferencia de pago en Mercado Pago (USANDO DATA SIMPLIFICADA PARA DEPURAR)
        const simplePreferenceData = { // <--- PREFERENCIA SIMPLIFICADA
            items: [
                {
                    title: "Compra de Fotos Escolares", // Título genérico para la prueba
                    unit_price: parseFloat(totalAmount), // El total de tu carrito
                    quantity: 1,
                    currency_id: 'ARS',
                }
            ],
            external_reference: orderData.id,
            back_urls: {
                success: `${process.env.FRONTEND_URL}/success.html?orderId=${orderData.id}`,
                failure: `${process.env.FRONTEND_URL}/failure.html?orderId=${orderData.id}`,
                pending: `${process.env.FRONTEND_URL}/pending.html?orderId=${orderData.id}`
            },
            notification_url: `${process.env.BACKEND_URL}/mercadopago-webhook`
            // `auto_return` comentado o eliminado como ya habíamos acordado
        };

        // Usa la instancia 'preference' creada al inicio con el 'client'
        const responseMP = await preference.create({ body: simplePreferenceData }); // <-- ¡USA simplePreferenceData AQUÍ!
        
        // ##########################################################################
        // # LÍNEA DE DEBUGGING CRÍTICA: IMPRIME LA RESPUESTA COMPLETA DE MERCADO PAGO
        // ##########################################################################
        console.log('Respuesta COMPLETA de Mercado Pago (para depuración):', JSON.stringify(responseMP, null, 2));

       // Determinar qué init_point usar (sandbox o producción)
        const redirectUrl = process.env.NODE_ENV === 'production' 
                            ? responseMP.init_point 
                            : responseMP.sandbox_init_point;
        
        res.status(200).json({
            message: 'Preferencia de pago creada exitosamente.',
            init_point: redirectUrl, // <-- ¡ACCEDE DIRECTAMENTE A responseMP.init_point O sandbox_init_point!
            payment_id: responseMP.id, // <-- ¡ACCEDE DIRECTAMENTE A responseMP.id!
            orderId: orderData.id
        });

    } catch (err) {
        console.error('Error al crear preferencia de pago en Mercado Pago (catch):', err); // <-- Más logs
        res.status(500).json({ message: 'Error interno del servidor al crear preferencia de pago.' });
    }
});

// Ruta para subir fotos a un álbum específico
// Espera una o más imágenes bajo el campo 'photos' en el formulario.
// Necesita el 'albumId' como parámetro de la URL.
app.post('/upload-photos/:albumId', upload.array('photos'), async (req, res) => {
    const albumId = req.params.albumId;
    const photographerId = '65805569-2e32-46a0-97c5-c52e31e02866'; // <--- ¡IMPORTANTE! Reemplaza con el ID real de tu fotógrafo

    // 1. Validar el ID del álbum
    if (!albumId || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(albumId)) {
        return res.status(400).json({ message: 'ID de álbum no válido.' });
    }

    // 2. Verificar que el álbumId exista y pertenezca al fotógrafo
    try {
        const { data: album, error: albumError } = await supabase
            .from('albums')
            .select('id, photographer_user_id')
            .eq('id', albumId)
            .eq('photographer_user_id', photographerId) // Asegura que el álbum pertenece a este fotógrafo
            .single();

        if (albumError || !album) {
            console.error('Error al verificar álbum:', albumError ? albumError.message : 'Álbum no encontrado.');
            return res.status(404).json({ message: 'Álbum no encontrado o no autorizado para este fotógrafo.' });
        }
    } catch (dbError) {
        console.error('Error de base de datos al verificar álbum:', dbError);
        return res.status(500).json({ message: 'Error interno del servidor al verificar el álbum.' });
    }

    // 3. Verificar que se subieron archivos
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'No se subieron archivos.' });
    }

    const watermarkedPhotosPath = path.resolve(__dirname, 'assets', 'watermark.png');
    console.log('Intentando cargar marca de agua desde:', watermarkedPhotosPath); // <-- ¡Añade esta línea!
    // Verificar si el archivo de marca de agua existe
    if (!fs.existsSync(watermarkedPhotosPath)) {
        console.error(`Error: Archivo de marca de agua no encontrado en ${watermarkedPhotosPath}`);
        return res.status(500).json({ message: 'Error interno: Archivo de marca de agua no encontrado.' });
    }


    const results = []; // Para almacenar el resultado de cada subida

    // 4. Procesar cada archivo subido
    for (const file of req.files) {
        try {
            // Generar un nombre de archivo único para evitar colisiones
            const uniqueFileName = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}${path.extname(file.originalname)}`;
            const originalFilePath = `albums/${albumId}/original/${uniqueFileName}`;
            const watermarkedFilePath = `albums/${albumId}/watermarked/${uniqueFileName}`;

            // --- Subida de Imagen Original (a bucket privado) ---
            const { error: uploadOriginalError } = await supabaseAdmin.storage // <-- ¡CAMBIA 'supabase' a 'supabaseAdmin' AQUÍ!
                .from('original-photos') // Tu bucket privado
                .upload(originalFilePath, file.buffer, {
                    contentType: file.mimetype,
                    upsert: false // No sobrescribir si ya existe un archivo con el mismo nombre
                });

            if (uploadOriginalError) {
                console.error(`Error al subir la imagen original "${file.originalname}":`, uploadOriginalError.message);
                throw new Error(`Fallo al subir original: ${uploadOriginalError.message}`);
            }

            // --- Aplicar Marca de Agua con Sharp ---
            const watermarkedBuffer = await sharp(file.buffer)
                .composite([{
                    input: watermarkedPhotosPath, // Ruta al archivo de marca de agua
                    gravity: 'center', // Posición de la marca de agua (ej. 'center', 'southeast', 'northwest')
                    // Puedes ajustar el tamaño o la opacidad de la marca de agua aquí si es necesario
                    // Por ejemplo: opacity: 0.5, blend: 'overlay', tile: true
                }])
                .toFormat('jpeg', { quality: 80 }) // Formato y calidad para la versión con marca de agua (más ligera)
                .toBuffer();

            // --- Subida de Imagen con Marca de Agua (a bucket público) ---
            const { error: uploadWatermarkedError } = await supabase.storage
                .from('watermarked-photos') // Tu bucket público
                .upload(watermarkedFilePath, watermarkedBuffer, {
                    contentType: 'image/jpeg', // O 'image/png' si tu marca de agua requiere transparencia en la salida
                    upsert: false
                });

            if (uploadWatermarkedError) {
                console.error(`Error al subir la imagen con marca de agua "${file.originalname}":`, uploadWatermarkedError.message);
                throw new Error(`Fallo al subir marcada de agua: ${uploadWatermarkedError.message}`);
            }

            // --- Obtener URL pública para la imagen con marca de agua ---
            const publicWatermarkedUrl = `${supabaseUrl}/storage/v1/object/public/watermarked-photos/${watermarkedFilePath}`;

            // --- Insertar metadatos en la base de datos `photos` ---
            const { data: photoDbData, error: dbInsertError } = await supabase
                .from('photos')
                .insert([
                    {
                        album_id: albumId,
                        original_file_path: originalFilePath, // Guarda solo la ruta relativa en Storage
                        watermarked_file_path: watermarkedFilePath, // Guarda solo la ruta relativa en Storage
                        student_code: null, // Asume que esto se añadirá después o desde el frontend
                        price: 15.00, // Precio por defecto, ajusta según tu lógica
                        metadata: {
                            originalName: file.originalname,
                            mimetype: file.mimetype,
                            size: file.size
                        }
                    }
                ])
                .select() // Devuelve la fila insertada
                .single(); // Espera una sola fila

            if (dbInsertError) {
                console.error(`Error al insertar en la BD para "${file.originalname}":`, dbInsertError.message);
                // Opcional: Si falla la BD, podrías intentar borrar los archivos subidos para limpiar
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

// --- Iniciar el servidor ---
app.listen(PORT, () => {
    console.log(`Servidor backend escuchando en http://localhost:${PORT}`);
    console.log('¡Listo para la acción con Supabase y Sharp!');
});