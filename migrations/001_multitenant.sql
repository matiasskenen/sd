-- =====================================================
-- MIGRACIÓN: MULTI-TENANT PARA PLATAFORMA DE FOTÓGRAFOS
-- =====================================================

-- 1. TABLA: photographers (usuarios del servicio)
CREATE TABLE IF NOT EXISTS photographers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    
    -- Info del negocio
    business_name VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL, -- URL: /fotografo/slug
    bio TEXT,
    profile_image_url TEXT,
    
    -- Plan y facturación
    plan_type VARCHAR(20) NOT NULL DEFAULT 'pro', -- 'pro', 'premium'
    subscription_status VARCHAR(20) DEFAULT 'trial', -- 'trial', 'active', 'cancelled', 'expired'
    subscription_expires_at TIMESTAMPTZ,
    trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
    
    -- Estadísticas
    total_albums INT DEFAULT 0,
    total_photos INT DEFAULT 0,
    total_sales DECIMAL(10,2) DEFAULT 0,
    rating DECIMAL(3,2) DEFAULT 0,
    total_reviews INT DEFAULT 0,
    
    -- Configuración
    default_price_per_photo DECIMAL(10,2) DEFAULT 1500.00, -- Precio por defecto en centavos (15 ARS)
    watermark_text VARCHAR(100),
    custom_watermark_url TEXT,
    
    -- Contacto
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(50),
    website VARCHAR(255),
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    is_verified BOOLEAN DEFAULT false,
    is_featured BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    
    CONSTRAINT valid_plan CHECK (plan_type IN ('pro', 'premium')),
    CONSTRAINT valid_status CHECK (subscription_status IN ('trial', 'active', 'cancelled', 'expired', 'past_due'))
);

-- Índices para búsquedas
CREATE INDEX idx_photographers_plan ON photographers(plan_type);
CREATE INDEX idx_photographers_rating ON photographers(rating DESC);
CREATE INDEX idx_photographers_sales ON photographers(total_sales DESC);
CREATE INDEX idx_photographers_featured ON photographers(is_featured, rating DESC);
CREATE INDEX idx_photographers_slug ON photographers(slug);
CREATE INDEX idx_photographers_status ON photographers(subscription_status);

-- 2. TABLA: plans (definición de planes)
CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) NOT NULL UNIQUE, -- 'pro', 'premium'
    display_name VARCHAR(100) NOT NULL,
    price_cents INT NOT NULL, -- Precio en centavos (499900 = $4999.00)
    billing_period VARCHAR(20) NOT NULL DEFAULT 'monthly',
    
    -- Límites
    max_albums INT, -- NULL = ilimitado
    max_photos_per_album INT,
    max_total_photos INT,
    max_storage_gb INT,
    
    -- Features
    custom_watermark BOOLEAN DEFAULT false,
    custom_domain BOOLEAN DEFAULT false,
    priority_support BOOLEAN DEFAULT false,
    analytics_dashboard BOOLEAN DEFAULT false,
    remove_platform_branding BOOLEAN DEFAULT false,
    api_access BOOLEAN DEFAULT false,
    
    description TEXT,
    features_json JSONB,
    is_active BOOLEAN DEFAULT true,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Planes iniciales (precios en centavos ARS)
INSERT INTO plans (name, display_name, price_cents, billing_period, max_albums, max_photos_per_album, max_total_photos, max_storage_gb, custom_watermark, analytics_dashboard, sort_order, description, features_json) VALUES
(
    'pro', 
    'Plan Pro', 
    499900, -- $4999.00 ARS
    'monthly', 
    50, 
    1000, 
    10000, 
    100,
    true,
    true,
    1,
    'Perfecto para fotógrafos profesionales que trabajan con múltiples eventos',
    '["50 álbumes", "1000 fotos por álbum", "100GB de almacenamiento", "Marca de agua personalizada", "Dashboard de estadísticas", "Soporte prioritario"]'
),
(
    'premium', 
    'Plan Premium', 
    1299900, -- $12999.00 ARS
    'monthly', 
    NULL, -- ilimitado
    NULL, -- ilimitado
    NULL, -- ilimitado
    1000,
    true,
    true,
    2,
    'Para estudios profesionales con alto volumen de eventos',
    '["Álbumes ilimitados", "Fotos ilimitadas", "1TB de almacenamiento", "Marca de agua personalizada", "Dashboard de estadísticas avanzadas", "Soporte prioritario 24/7", "API access", "Sin branding de la plataforma"]'
);

UPDATE plans SET 
    priority_support = true,
    remove_platform_branding = false
WHERE name = 'pro';

UPDATE plans SET 
    priority_support = true,
    remove_platform_branding = true,
    api_access = true
WHERE name = 'premium';

-- 3. TABLA: subscriptions (historial de suscripciones)
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    photographer_id UUID REFERENCES photographers(id) ON DELETE CASCADE,
    plan_id UUID REFERENCES plans(id),
    
    -- Mercado Pago
    mercadopago_preapproval_id VARCHAR(255) UNIQUE, -- ID de suscripción en MP
    mercadopago_payer_id VARCHAR(255),
    
    status VARCHAR(20) NOT NULL, -- 'active', 'cancelled', 'paused', 'expired'
    
    -- Fechas
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    cancelled_at TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN DEFAULT false,
    
    -- Precio en el momento de la suscripción (puede cambiar en el futuro)
    amount_cents INT NOT NULL,
    currency VARCHAR(3) DEFAULT 'ARS',
    billing_period VARCHAR(20) NOT NULL,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT valid_subscription_status CHECK (status IN ('active', 'cancelled', 'paused', 'expired', 'past_due'))
);

CREATE INDEX idx_subscriptions_photographer ON subscriptions(photographer_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_period_end ON subscriptions(current_period_end);

-- 4. TABLA: subscription_payments (pagos mensuales)
CREATE TABLE IF NOT EXISTS subscription_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE CASCADE,
    photographer_id UUID REFERENCES photographers(id),
    plan_id UUID REFERENCES plans(id),
    
    -- Mercado Pago
    mercadopago_payment_id VARCHAR(255) UNIQUE,
    
    amount_cents INT NOT NULL,
    currency VARCHAR(3) DEFAULT 'ARS',
    status VARCHAR(20) NOT NULL, -- 'pending', 'approved', 'rejected', 'refunded'
    
    -- Fechas
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    paid_at TIMESTAMPTZ,
    
    -- Metadata
    payment_method VARCHAR(50),
    failure_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT valid_payment_status CHECK (status IN ('pending', 'approved', 'rejected', 'refunded', 'cancelled'))
);

CREATE INDEX idx_subscription_payments_subscription ON subscription_payments(subscription_id);
CREATE INDEX idx_subscription_payments_photographer ON subscription_payments(photographer_id);
CREATE INDEX idx_subscription_payments_status ON subscription_payments(status);
CREATE INDEX idx_subscription_payments_paid_at ON subscription_payments(paid_at);

-- 5. MODIFICAR TABLA: albums (agregar relación con fotógrafo)
ALTER TABLE albums 
ADD COLUMN IF NOT EXISTS photographer_id UUID REFERENCES photographers(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS slug VARCHAR(255),
ADD COLUMN IF NOT EXISTS cover_photo_id UUID REFERENCES photos(id),
ADD COLUMN IF NOT EXISTS views INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS featured_until TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS seo_title VARCHAR(255),
ADD COLUMN IF NOT EXISTS seo_description TEXT;

-- Migrar datos existentes: vincular álbumes al primer fotógrafo
-- (ejecutar solo si ya tenés álbumes)
-- UPDATE albums SET photographer_id = (SELECT id FROM photographers LIMIT 1) WHERE photographer_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_albums_photographer ON albums(photographer_id);
CREATE INDEX IF NOT EXISTS idx_albums_public ON albums(is_public);
CREATE INDEX IF NOT EXISTS idx_albums_slug ON albums(slug);
CREATE INDEX IF NOT EXISTS idx_albums_featured ON albums(featured_until) WHERE featured_until IS NOT NULL;

-- 6. MODIFICAR TABLA: photos (agregar stats)
ALTER TABLE photos 
ADD COLUMN IF NOT EXISTS views INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS purchases INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_photos_featured ON photos(is_featured) WHERE is_featured = true;

-- 7. MODIFICAR TABLA: orders (agregar relación con fotógrafo)
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS photographer_id UUID REFERENCES photographers(id);

CREATE INDEX IF NOT EXISTS idx_orders_photographer ON orders(photographer_id);

-- 8. TABLA: reviews (opiniones de clientes)
CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    photographer_id UUID REFERENCES photographers(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    
    customer_email VARCHAR(255) NOT NULL,
    customer_name VARCHAR(255),
    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_verified BOOLEAN DEFAULT false, -- true = compró realmente
    is_visible BOOLEAN DEFAULT true,
    
    UNIQUE(order_id) -- Una review por orden
);

CREATE INDEX idx_reviews_photographer ON reviews(photographer_id);
CREATE INDEX idx_reviews_rating ON reviews(rating);
CREATE INDEX idx_reviews_visible ON reviews(is_visible) WHERE is_visible = true;

-- 9. FUNCIÓN: Actualizar rating del fotógrafo
CREATE OR REPLACE FUNCTION update_photographer_rating()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE photographers
    SET 
        rating = (
            SELECT COALESCE(AVG(rating), 0)
            FROM reviews
            WHERE photographer_id = NEW.photographer_id
            AND is_visible = true
        ),
        total_reviews = (
            SELECT COUNT(*)
            FROM reviews
            WHERE photographer_id = NEW.photographer_id
            AND is_visible = true
        ),
        updated_at = NOW()
    WHERE id = NEW.photographer_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_photographer_rating
AFTER INSERT OR UPDATE OR DELETE ON reviews
FOR EACH ROW
EXECUTE FUNCTION update_photographer_rating();

-- 10. FUNCIÓN: Actualizar estadísticas del fotógrafo
CREATE OR REPLACE FUNCTION update_photographer_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_TABLE_NAME = 'albums' THEN
        UPDATE photographers
        SET 
            total_albums = (SELECT COUNT(*) FROM albums WHERE photographer_id = NEW.photographer_id),
            updated_at = NOW()
        WHERE id = NEW.photographer_id;
    ELSIF TG_TABLE_NAME = 'photos' THEN
        UPDATE photographers
        SET 
            total_photos = (SELECT COUNT(*) FROM photos p JOIN albums a ON p.album_id = a.id WHERE a.photographer_id = NEW.photographer_id),
            updated_at = NOW()
        WHERE id = (SELECT photographer_id FROM albums WHERE id = NEW.album_id);
    ELSIF TG_TABLE_NAME = 'orders' THEN
        UPDATE photographers
        SET 
            total_sales = (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE photographer_id = NEW.photographer_id AND status = 'paid'),
            updated_at = NOW()
        WHERE id = NEW.photographer_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_stats_albums
AFTER INSERT OR DELETE ON albums
FOR EACH ROW
EXECUTE FUNCTION update_photographer_stats();

CREATE TRIGGER trigger_update_stats_photos
AFTER INSERT OR DELETE ON photos
FOR EACH ROW
EXECUTE FUNCTION update_photographer_stats();

CREATE TRIGGER trigger_update_stats_orders
AFTER INSERT OR UPDATE ON orders
FOR EACH ROW
WHEN (NEW.status = 'paid')
EXECUTE FUNCTION update_photographer_stats();

-- 11. FUNCIÓN: Generar slug único
CREATE OR REPLACE FUNCTION generate_unique_slug(base_text TEXT, table_name TEXT)
RETURNS TEXT AS $$
DECLARE
    slug TEXT;
    counter INT := 0;
    exists BOOLEAN;
BEGIN
    -- Limpiar y normalizar
    slug := lower(regexp_replace(base_text, '[^a-z0-9\s-]', '', 'gi'));
    slug := regexp_replace(slug, '\s+', '-', 'g');
    slug := trim(both '-' from slug);
    
    -- Verificar si existe
    IF table_name = 'photographers' THEN
        SELECT COUNT(*) > 0 INTO exists FROM photographers WHERE photographers.slug = slug;
    ELSIF table_name = 'albums' THEN
        SELECT COUNT(*) > 0 INTO exists FROM albums WHERE albums.slug = slug;
    END IF;
    
    -- Agregar número si existe
    WHILE exists LOOP
        counter := counter + 1;
        slug := slug || '-' || counter::TEXT;
        
        IF table_name = 'photographers' THEN
            SELECT COUNT(*) > 0 INTO exists FROM photographers WHERE photographers.slug = slug;
        ELSIF table_name = 'albums' THEN
            SELECT COUNT(*) > 0 INTO exists FROM albums WHERE albums.slug = slug;
        END IF;
    END LOOP;
    
    RETURN slug;
END;
$$ LANGUAGE plpgsql;

-- 12. ROW LEVEL SECURITY (RLS)
-- Habilitar RLS en photographers
ALTER TABLE photographers ENABLE ROW LEVEL SECURITY;

-- Policy: Fotógrafos ven solo su perfil
CREATE POLICY "photographers_select_own" ON photographers
FOR SELECT USING (auth.uid() = auth_user_id);

-- Policy: Fotógrafos actualizan solo su perfil
CREATE POLICY "photographers_update_own" ON photographers
FOR UPDATE USING (auth.uid() = auth_user_id);

-- Habilitar RLS en albums (ya modificada)
ALTER TABLE albums ENABLE ROW LEVEL SECURITY;

-- Policy: Ver álbumes públicos de cualquier fotógrafo
CREATE POLICY "albums_select_public" ON albums
FOR SELECT USING (is_public = true);

-- Policy: Fotógrafos ven todos sus álbumes
CREATE POLICY "albums_select_own" ON albums
FOR SELECT USING (
    photographer_id IN (
        SELECT id FROM photographers WHERE auth_user_id = auth.uid()
    )
);

-- Policy: Fotógrafos crean solo en sus cuentas
CREATE POLICY "albums_insert_own" ON albums
FOR INSERT WITH CHECK (
    photographer_id IN (
        SELECT id FROM photographers WHERE auth_user_id = auth.uid()
    )
);

-- Policy: Fotógrafos actualizan solo sus álbumes
CREATE POLICY "albums_update_own" ON albums
FOR UPDATE USING (
    photographer_id IN (
        SELECT id FROM photographers WHERE auth_user_id = auth.uid()
    )
);

-- Policy: Fotógrafos eliminan solo sus álbumes
CREATE POLICY "albums_delete_own" ON albums
FOR DELETE USING (
    photographer_id IN (
        SELECT id FROM photographers WHERE auth_user_id = auth.uid()
    )
);

-- 13. FUNCIONES AUXILIARES
-- Función para verificar límites del plan
CREATE OR REPLACE FUNCTION check_plan_limits(
    p_photographer_id UUID,
    p_limit_type TEXT -- 'albums', 'photos', 'storage'
)
RETURNS BOOLEAN AS $$
DECLARE
    current_plan plans%ROWTYPE;
    current_count INT;
    photographer photographers%ROWTYPE;
BEGIN
    -- Obtener plan del fotógrafo
    SELECT p.* INTO photographer FROM photographers p WHERE p.id = p_photographer_id;
    SELECT pl.* INTO current_plan FROM plans pl WHERE pl.name = photographer.plan_type;
    
    IF p_limit_type = 'albums' THEN
        SELECT COUNT(*) INTO current_count FROM albums WHERE photographer_id = p_photographer_id;
        RETURN current_plan.max_albums IS NULL OR current_count < current_plan.max_albums;
    ELSIF p_limit_type = 'photos' THEN
        SELECT COUNT(*) INTO current_count 
        FROM photos ph 
        JOIN albums al ON ph.album_id = al.id 
        WHERE al.photographer_id = p_photographer_id;
        RETURN current_plan.max_total_photos IS NULL OR current_count < current_plan.max_total_photos;
    END IF;
    
    RETURN true;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- DATOS DE PRUEBA (comentar en producción)
-- =====================================================

-- Crear usuario de prueba en auth.users primero (hacer desde Supabase Dashboard)
-- Luego ejecutar:
/*
INSERT INTO photographers (
    auth_user_id,
    business_name,
    display_name,
    slug,
    email,
    phone,
    bio,
    plan_type,
    subscription_status
) VALUES (
    'TU-AUTH-USER-ID-AQUI', -- Reemplazar con el UUID de auth.users
    'Foto Estudio Ejemplo',
    'Juan Pérez Fotografía',
    'juan-perez-fotografia',
    'juan@ejemplo.com',
    '+54 9 11 1234-5678',
    'Fotógrafo profesional especializado en eventos escolares con más de 10 años de experiencia.',
    'pro',
    'active'
);
*/

-- =====================================================
-- VERIFICACIÓN
-- =====================================================
-- Ejecutar para verificar que todo se creó correctamente:
/*
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('photographers', 'plans', 'subscriptions', 'subscription_payments', 'reviews')
ORDER BY table_name;
*/
