const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// ========================================
// AUTENTICACIÓN
// ========================================

// POST /auth/register - Registro de nuevo fotógrafo
router.post('/register', async (req, res) => {
    try {
        const { email, password, businessName, displayName, phone } = req.body;

        // Validaciones
        if (!email || !password || !businessName || !displayName) {
            return res.status(400).json({ 
                error: 'Email, contraseña, nombre del negocio y nombre para mostrar son requeridos' 
            });
        }

        if (password.length < 8) {
            return res.status(400).json({ 
                error: 'La contraseña debe tener al menos 8 caracteres' 
            });
        }

        // 1. Crear usuario en auth.users
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: email.toLowerCase(),
            password: password,
            email_confirm: true, // Auto-confirmar email (cambiar en producción)
            user_metadata: {
                business_name: businessName,
                display_name: displayName,
                role: 'photographer'
            }
        });

        if (authError) {
            console.error('Error creando usuario:', authError);
            return res.status(400).json({ 
                error: authError.message || 'Error al crear usuario' 
            });
        }

        // 2. Generar slug único
        const baseSlug = displayName
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .trim();

        let slug = baseSlug;
        let counter = 0;
        let slugExists = true;

        while (slugExists) {
            const { data: existing } = await supabaseAdmin
                .from('photographers')
                .select('id')
                .eq('slug', slug)
                .single();

            if (!existing) {
                slugExists = false;
            } else {
                counter++;
                slug = `${baseSlug}-${counter}`;
            }
        }

        // 3. Crear perfil de fotógrafo
        const { data: photographer, error: photographerError } = await supabaseAdmin
            .from('photographers')
            .insert({
                auth_user_id: authData.user.id,
                business_name: businessName,
                display_name: displayName,
                slug: slug,
                email: email.toLowerCase(),
                phone: phone || null,
                plan_type: 'pro', // Plan por defecto
                subscription_status: 'trial', // 14 días de prueba
                trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
            })
            .select()
            .single();

        if (photographerError) {
            console.error('Error creando perfil de fotógrafo:', photographerError);
            
            // Rollback: eliminar usuario de auth
            await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
            
            return res.status(500).json({ 
                error: 'Error al crear perfil de fotógrafo' 
            });
        }

        res.status(201).json({
            message: 'Registro exitoso. Tienes 14 días de prueba gratis.',
            photographer: {
                id: photographer.id,
                email: photographer.email,
                businessName: photographer.business_name,
                displayName: photographer.display_name,
                slug: photographer.slug,
                planType: photographer.plan_type,
                subscriptionStatus: photographer.subscription_status,
                trialEndsAt: photographer.trial_ends_at
            }
        });

    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor' 
        });
    }
});

// POST /auth/login - Login de fotógrafo
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ 
                error: 'Email y contraseña son requeridos' 
            });
        }

        // 1. Verificar credenciales usando admin API
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserByEmail(email.toLowerCase());

        if (authError || !authData.user) {
            return res.status(401).json({ 
                error: 'Credenciales inválidas' 
            });
        }

        // Verificar password usando signInWithPassword del cliente anon
        const supabase = createClient(supabaseUrl, process.env.SUPABASE_ANON_KEY);
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email: email.toLowerCase(),
            password: password
        });

        if (signInError) {
            return res.status(401).json({ 
                error: 'Credenciales inválidas' 
            });
        }

        // 2. Obtener perfil de fotógrafo
        const { data: photographer, error: photographerError } = await supabaseAdmin
            .from('photographers')
            .select('*')
            .eq('auth_user_id', authData.user.id)
            .single();

        if (photographerError || !photographer) {
            return res.status(404).json({ 
                error: 'Perfil de fotógrafo no encontrado' 
            });
        }

        // 3. Verificar estado de suscripción
        const now = new Date();
        const trialEnded = photographer.trial_ends_at && new Date(photographer.trial_ends_at) < now;
        const subscriptionExpired = photographer.subscription_expires_at && 
                                    new Date(photographer.subscription_expires_at) < now;

        if (trialEnded && subscriptionExpired) {
            await supabaseAdmin
                .from('photographers')
                .update({ subscription_status: 'expired' })
                .eq('id', photographer.id);

            return res.status(403).json({
                error: 'Tu período de prueba ha expirado. Por favor, suscríbete para continuar.',
                needsSubscription: true,
                photographer: {
                    id: photographer.id,
                    email: photographer.email,
                    subscriptionStatus: 'expired'
                }
            });
        }

        // 4. Actualizar last_login_at
        await supabaseAdmin
            .from('photographers')
            .update({ last_login_at: new Date().toISOString() })
            .eq('id', photographer.id);

        res.status(200).json({
            message: 'Login exitoso',
            photographer: {
                id: photographer.id,
                email: photographer.email,
                businessName: photographer.business_name,
                displayName: photographer.display_name,
                slug: photographer.slug,
                planType: photographer.plan_type,
                subscriptionStatus: photographer.subscription_status,
                trialEndsAt: photographer.trial_ends_at,
                subscriptionExpiresAt: photographer.subscription_expires_at,
                profileImageUrl: photographer.profile_image_url,
                stats: {
                    totalAlbums: photographer.total_albums,
                    totalPhotos: photographer.total_photos,
                    totalSales: photographer.total_sales,
                    rating: photographer.rating
                }
            },
            session: signInData.session
        });

    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor' 
        });
    }
});

// POST /auth/logout
router.post('/logout', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (token) {
            await supabaseAdmin.auth.signOut(token);
        }

        res.status(200).json({ message: 'Logout exitoso' });
    } catch (error) {
        console.error('Error en logout:', error);
        res.status(500).json({ error: 'Error al cerrar sesión' });
    }
});

// GET /auth/me - Obtener datos del usuario actual
router.get('/me', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ error: 'Token no proporcionado' });
        }

        // Verificar token
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

        if (authError || !user) {
            return res.status(401).json({ error: 'Token inválido' });
        }

        // Obtener perfil
        const { data: photographer, error: photographerError } = await supabaseAdmin
            .from('photographers')
            .select('*')
            .eq('auth_user_id', user.id)
            .single();

        if (photographerError || !photographer) {
            return res.status(404).json({ error: 'Perfil no encontrado' });
        }

        res.status(200).json({
            photographer: {
                id: photographer.id,
                email: photographer.email,
                businessName: photographer.business_name,
                displayName: photographer.display_name,
                slug: photographer.slug,
                bio: photographer.bio,
                profileImageUrl: photographer.profile_image_url,
                planType: photographer.plan_type,
                subscriptionStatus: photographer.subscription_status,
                trialEndsAt: photographer.trial_ends_at,
                subscriptionExpiresAt: photographer.subscription_expires_at,
                phone: photographer.phone,
                website: photographer.website,
                defaultPricePerPhoto: photographer.default_price_per_photo,
                watermarkText: photographer.watermark_text,
                stats: {
                    totalAlbums: photographer.total_albums,
                    totalPhotos: photographer.total_photos,
                    totalSales: photographer.total_sales,
                    rating: photographer.rating,
                    totalReviews: photographer.total_reviews
                },
                isVerified: photographer.is_verified,
                isFeatured: photographer.is_featured,
                createdAt: photographer.created_at
            }
        });

    } catch (error) {
        console.error('Error obteniendo perfil:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;
