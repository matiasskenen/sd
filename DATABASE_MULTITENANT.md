# Arquitectura Multi-Tenant - Fotos Escolares SaaS

## 🏗️ Estructura de Base de Datos

### 1. Tabla: `photographers` (Nuevos usuarios del servicio)

```sql
CREATE TABLE photographers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Info del negocio
    business_name VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    bio TEXT,
    profile_image_url TEXT,
    
    -- Plan y facturación
    plan_type VARCHAR(20) NOT NULL DEFAULT 'free', -- 'free', 'pro', 'premium'
    subscription_status VARCHAR(20) DEFAULT 'active', -- 'active', 'cancelled', 'expired'
    subscription_expires_at TIMESTAMPTZ,
    
    -- Estadísticas
    total_albums INT DEFAULT 0,
    total_photos INT DEFAULT 0,
    total_sales DECIMAL(10,2) DEFAULT 0,
    rating DECIMAL(3,2) DEFAULT 0,
    total_reviews INT DEFAULT 0,
    
    -- Configuración
    price_per_photo DECIMAL(10,2) DEFAULT 15.00,
    watermark_text VARCHAR(100),
    custom_watermark_url TEXT,
    
    -- Contacto
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(50),
    website VARCHAR(255),
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_verified BOOLEAN DEFAULT false,
    is_featured BOOLEAN DEFAULT false,
    
    CONSTRAINT valid_plan CHECK (plan_type IN ('free', 'pro', 'premium')),
    CONSTRAINT valid_status CHECK (subscription_status IN ('active', 'cancelled', 'expired', 'trial'))
);

-- Índices para búsquedas
CREATE INDEX idx_photographers_plan ON photographers(plan_type);
CREATE INDEX idx_photographers_rating ON photographers(rating DESC);
CREATE INDEX idx_photographers_sales ON photographers(total_sales DESC);
CREATE INDEX idx_photographers_featured ON photographers(is_featured, rating DESC);
```

### 2. Tabla: `plans` (Definición de planes)

```sql
CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) NOT NULL UNIQUE, -- 'free', 'pro', 'premium'
    display_name VARCHAR(100) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    billing_period VARCHAR(20) NOT NULL, -- 'monthly', 'yearly'
    
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
    
    -- Comisión de la plataforma
    platform_commission_percent DECIMAL(5,2) NOT NULL, -- ej: 10.00 = 10%
    
    description TEXT,
    features_json JSONB,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Planes por defecto
INSERT INTO plans (name, display_name, price, billing_period, max_albums, max_photos_per_album, max_total_photos, max_storage_gb, platform_commission_percent) VALUES
('free', 'Plan Gratis', 0, 'monthly', 3, 50, 150, 1, 15.00),
('pro', 'Plan Pro', 2999, 'monthly', 20, 500, 5000, 50, 10.00),
('premium', 'Plan Premium', 9999, 'monthly', NULL, NULL, NULL, 500, 5.00);
```

### 3. Tabla: `albums` (Modificada)

```sql
ALTER TABLE albums 
ADD COLUMN photographer_id UUID REFERENCES photographers(id) ON DELETE CASCADE,
ADD COLUMN is_public BOOLEAN DEFAULT true,
ADD COLUMN slug VARCHAR(255) UNIQUE, -- para URLs amigables: /fotografo/slug/album/slug
ADD COLUMN cover_photo_id UUID REFERENCES photos(id),
ADD COLUMN views INT DEFAULT 0,
ADD COLUMN featured_until TIMESTAMPTZ;

-- Índice para búsquedas
CREATE INDEX idx_albums_photographer ON albums(photographer_id);
CREATE INDEX idx_albums_public ON albums(is_public);
CREATE INDEX idx_albums_slug ON albums(slug);
```

### 4. Tabla: `photos` (Sin cambios mayores)

```sql
-- Ya tienes la estructura, solo agregar:
ALTER TABLE photos 
ADD COLUMN views INT DEFAULT 0,
ADD COLUMN is_featured BOOLEAN DEFAULT false;
```

### 5. Tabla: `orders` (Modificada)

```sql
ALTER TABLE orders
ADD COLUMN photographer_id UUID REFERENCES photographers(id),
ADD COLUMN platform_commission DECIMAL(10,2), -- Comisión que se queda la plataforma
ADD COLUMN photographer_earnings DECIMAL(10,2); -- Lo que recibe el fotógrafo
```

### 6. Tabla: `reviews` (Nueva)

```sql
CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    photographer_id UUID REFERENCES photographers(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    
    customer_email VARCHAR(255) NOT NULL,
    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_verified BOOLEAN DEFAULT false, -- Solo si compró
    
    UNIQUE(order_id) -- Una review por orden
);

CREATE INDEX idx_reviews_photographer ON reviews(photographer_id);
```

### 7. Tabla: `subscriptions` (Nueva - historial de pagos)

```sql
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    photographer_id UUID REFERENCES photographers(id) ON DELETE CASCADE,
    plan_id UUID REFERENCES plans(id),
    
    -- Mercado Pago
    mercadopago_subscription_id VARCHAR(255) UNIQUE,
    mercadopago_preapproval_id VARCHAR(255),
    
    status VARCHAR(20) NOT NULL, -- 'active', 'cancelled', 'paused', 'expired'
    started_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    
    -- Precio en el momento de la suscripción
    amount DECIMAL(10,2) NOT NULL,
    billing_period VARCHAR(20) NOT NULL,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_photographer ON subscriptions(photographer_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
```

### 8. Tabla: `payments` (Nueva - tracking de pagos de suscripción)

```sql
CREATE TABLE subscription_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE CASCADE,
    photographer_id UUID REFERENCES photographers(id),
    
    mercadopago_payment_id VARCHAR(255) UNIQUE,
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) NOT NULL, -- 'approved', 'pending', 'rejected'
    
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 🎨 Frontend - Estructura de Rutas

### Público (Landing + Marketplace)
```
/                          → Landing page
/fotografos                → Directorio de fotógrafos (grid con filtros)
/fotografo/:slug           → Perfil público del fotógrafo
/fotografo/:slug/:album    → Álbum específico
/galeria                   → Galería global (todas las fotos destacadas)
/planes                    → Página de pricing
/como-funciona             → Explicación del servicio
/contacto                  → Formulario de contacto
```

### Autenticación
```
/login                     → Login para fotógrafos
/register                  → Registro nuevo fotógrafo
/forgot-password           → Recuperar contraseña
```

### Panel del Fotógrafo (Dashboard)
```
/dashboard                 → Overview (ventas, stats, álbumes recientes)
/dashboard/albumes         → Gestión de álbumes
/dashboard/albumes/nuevo   → Crear álbum
/dashboard/albumes/:id     → Editar álbum / subir fotos
/dashboard/ventas          → Historial de ventas
/dashboard/clientes        → Lista de clientes
/dashboard/configuracion   → Ajustes del negocio
/dashboard/plan            → Gestión de suscripción
/dashboard/perfil          → Editar perfil público
/dashboard/estadisticas    → Analytics detalladas
```

### Admin (Super Admin)
```
/admin/fotografos          → Lista de todos los fotógrafos
/admin/pagos               → Pagos de suscripciones
/admin/reportes            → Reportes financieros
/admin/planes              → Gestionar planes
```

## 💰 Modelo de Monetización

### Opción 1: Suscripción Mensual + Comisión
```javascript
const PRICING = {
    free: {
        monthly: 0,
        commission: 15%, // La plataforma se queda con 15% de cada venta
        limits: {
            albums: 3,
            photosPerAlbum: 50,
            totalPhotos: 150,
            storage: '1GB'
        }
    },
    pro: {
        monthly: 2999, // ARS (ajustar según mercado)
        commission: 10%,
        limits: {
            albums: 20,
            photosPerAlbum: 500,
            totalPhotos: 5000,
            storage: '50GB'
        }
    },
    premium: {
        monthly: 9999,
        commission: 5%,
        limits: {
            albums: 'unlimited',
            photosPerAlbum: 'unlimited',
            totalPhotos: 'unlimited',
            storage: '500GB'
        }
    }
};
```

### Opción 2: Solo Comisión (sin suscripción)
```javascript
// Más fácil para empezar
const COMMISSION = {
    standard: 12%, // Para todos los fotógrafos
    verified: 8%,  // Fotógrafos verificados
    premium: 5%    // Top performers
};
```

## 🔍 Galería Pública - Ideas de Implementación

### Opción A: Marketplace Competitivo
```javascript
// Página /galeria muestra fotos de TODOS los fotógrafos
// Algoritmo de ranking:
const photoScore = (photo) => {
    return (
        photo.views * 0.3 +
        photo.purchases * 2.0 +
        photo.photographer.rating * 0.5 +
        (photo.is_featured ? 10 : 0)
    );
};
```

**Ventajas:**
- Más tráfico para todos
- Descubrimiento de nuevos fotógrafos
- Competencia saludable

**Desventajas:**
- Fotógrafos pueden no querer compartir clientes

### Opción B: Perfiles Individuales + Directorio
```javascript
// Cada fotógrafo tiene su perfil aislado: /fotografo/juan-perez
// La galería principal solo muestra fotógrafos destacados o con mejor rating
// Los clientes buscan por colegio/evento/fotógrafo
```

**Ventajas:**
- Fotógrafos se sienten dueños de su espacio
- Más profesional
- B2B: colegios buscan fotógrafo específico

**Desventajas:**
- Menos descubrimiento orgánico

### Opción C: Híbrido (RECOMENDADO)
```
1. Landing page con fotógrafos destacados
2. /fotografos → Directorio filtrable (por ubicación, rating, precio)
3. /galeria → Galería global OPCIONAL (fotógrafos pueden opt-in)
4. Cada fotógrafo tiene perfil privado: /fotografo/:slug
5. Los clientes reciben link directo al álbum de su evento
```

## 🚀 MVP - Orden de Implementación

### Fase 1: Multi-tenant básico (2-3 semanas)
1. ✅ Crear tablas: photographers, plans, subscriptions
2. ✅ Sistema de registro/login para fotógrafos
3. ✅ Dashboard básico (listar álbumes, subir fotos)
4. ✅ Vincular álbumes a fotógrafo autenticado (quitar hardcoded ID)

### Fase 2: Perfiles públicos (1-2 semanas)
5. ✅ Página de perfil público: `/fotografo/:slug`
6. ✅ Landing page con CTA "Crear cuenta gratis"
7. ✅ Directorio de fotógrafos `/fotografos`

### Fase 3: Monetización (2 semanas)
8. ✅ Integrar suscripciones con Mercado Pago
9. ✅ Sistema de comisiones en ventas
10. ✅ Panel de ventas para fotógrafos

### Fase 4: Optimizaciones (ongoing)
11. ✅ Sistema de reviews
12. ✅ Analytics dashboard
13. ✅ Galería pública opcional
14. ✅ SEO y marketing

## 🎯 Decisiones que necesitás tomar:

1. **Modelo de negocio:**
   - ¿Suscripción + comisión o solo comisión?
   - ¿Cuántos planes? (recomiendo 3: Free, Pro, Premium)

2. **Galería pública:**
   - ¿Opt-in (fotógrafos eligen aparecer) o automático?
   - ¿Ranking por ventas o por calidad?

3. **Marca blanca:**
   - ¿Los fotógrafos premium pueden usar su dominio? (ej: fotosjuanperez.com)
   - ¿O siempre es tudominio.com/fotografo/juan?

4. **Pagos:**
   - ¿Split payment (MP Split) o pagás vos a los fotógrafos mensualmente?

**¿Querés que empiece implementando la Fase 1 (multi-tenant básico)?**
