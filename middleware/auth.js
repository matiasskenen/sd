/**
 * Middleware de autenticación para endpoints protegidos
 * Verifica el JWT token y obtiene el photographer_id del usuario autenticado
 */

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/**
 * Middleware para verificar autenticación JWT
 * Agrega req.user y req.photographer al request
 */
async function requireAuth(req, res, next) {
    try {
        // Obtener token del header Authorization
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                error: "No autorizado",
                message: "Token de autenticación requerido",
            });
        }

        const token = authHeader.substring(7); // Quitar "Bearer "

        // Verificar token con Supabase
        const {
            data: { user },
            error,
        } = await supabase.auth.getUser(token);

        if (error || !user) {
            return res.status(401).json({
                error: "Token inválido",
                message: "El token de autenticación no es válido o ha expirado",
            });
        }

        // Obtener photographer asociado al auth_user_id (usando admin client para bypass RLS)
        const { data: photographer, error: photographerError } = await supabaseAdmin
            .from("photographers")
            .select("*")
            .eq("auth_user_id", user.id)
            .single();

        if (photographerError || !photographer) {
            console.error("Error buscando fotógrafo:", { 
                user_id: user.id, 
                error: photographerError 
            });
            return res.status(403).json({
                error: "Fotógrafo no encontrado",
                message: "No se encontró un perfil de fotógrafo para este usuario",
            });
        }

        // Verificar estado de suscripción
        const now = new Date();
        const trialEndsAt = photographer.trial_ends_at ? new Date(photographer.trial_ends_at) : null;
        const subscriptionExpiresAt = photographer.subscription_expires_at ? new Date(photographer.subscription_expires_at) : null;

        // Si está en trial y no expiró, permitir acceso
        if (photographer.subscription_status === "trial" && trialEndsAt && trialEndsAt > now) {
            req.user = user;
            req.photographer = photographer;
            return next();
        }

        // Si está activo y no expiró, permitir acceso
        if (photographer.subscription_status === "active" && (!subscriptionExpiresAt || subscriptionExpiresAt > now)) {
            req.user = user;
            req.photographer = photographer;
            return next();
        }

        // Suscripción expirada o cancelada
        return res.status(403).json({
            error: "Suscripción inactiva",
            message: "Tu suscripción ha expirado. Por favor, renueva tu plan para continuar.",
            subscription_status: photographer.subscription_status,
        });
    } catch (error) {
        console.error("Error en middleware de autenticación:", error);
        return res.status(500).json({
            error: "Error de autenticación",
            message: "Ocurrió un error al verificar la autenticación",
        });
    }
}

/**
 * Middleware opcional - permite acceso sin auth pero agrega photographer si existe
 */
async function optionalAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return next(); // Sin auth, continuar sin photographer
        }

        const token = authHeader.substring(7);

        const {
            data: { user },
        } = await supabase.auth.getUser(token);

        if (user) {
            const { data: photographer } = await supabaseAdmin.from("photographers").select("*").eq("auth_user_id", user.id).single();

            if (photographer) {
                req.user = user;
                req.photographer = photographer;
            }
        }

        next();
    } catch (error) {
        // Si falla, simplemente continuar sin auth
        next();
    }
}

module.exports = {
    requireAuth,
    optionalAuth,
};
