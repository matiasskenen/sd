# Guía de Hardening y Seguridad

## 🛡️ Medidas de Seguridad Implementadas

### 1. Rate Limiting ✅

**Implementado con `express-rate-limit`**

#### Rate Limiters Configurados:

**General (Todas las rutas):**
- 100 requests por IP cada 15 minutos
- Previene ataques de denegación de servicio (DoS)

**Autenticación (Login):**
- 5 intentos de login cada 15 minutos
- No cuenta requests exitosos
- Previene ataques de fuerza bruta

**Creación de Recursos:**
- 20 creaciones por hora
- Aplica a: álbumes, fotos, etc.
- Previene spam y abuso

**Webhooks:**
- 30 requests por minuto
- Más permisivo para Mercado Pago

#### Rutas Protegidas:
```javascript
POST /login                    → authLimiter (5/15min)
POST /albums                   → createLimiter (20/hora)
POST /mercadopago-webhook      → webhookLimiter (30/min)
Todas las demás               → generalLimiter (100/15min)
```

### 2. CORS Configurado ✅

**Whitelist de dominios permitidos**

Configuración en `.env`:
```env
ALLOWED_ORIGINS=http://localhost:3000,https://tudominio.com,https://www.tudominio.com
```

**Comportamiento:**
- ✅ Solo dominios en la whitelist pueden hacer requests
- ✅ En desarrollo: permite todos los orígenes
- ✅ Permite requests sin origin (mobile apps, Postman)
- ✅ Credentials habilitados
- ✅ Logs de requests bloqueados

### 3. Helmet - Headers de Seguridad ✅

**Headers HTTP seguros automáticos:**

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security` (en producción con HTTPS)

**Deshabilitado:**
- CSP (Content Security Policy) - porque usamos CDN de Tailwind
- COEP - para permitir imágenes de Supabase

### 4. HTTPS / SSL/TLS 🔒

#### En Desarrollo (localhost):
HTTP está bien, pero para testing de webhooks de Mercado Pago necesitas HTTPS:

**Opción 1: ngrok (Recomendado para testing)**
```bash
# Instalar ngrok
npm install -g ngrok

# Exponer puerto 3000
ngrok http 3000

# Usar la URL https://xxx.ngrok.io como BACKEND_URL
```

**Opción 2: localtunnel**
```bash
npm install -g localtunnel
lt --port 3000
```

#### En Producción:

**Opción 1: Reverse Proxy con Nginx**
```nginx
server {
    listen 443 ssl http2;
    server_name tudominio.com;

    ssl_certificate /etc/letsencrypt/live/tudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tudominio.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name tudominio.com;
    return 301 https://$host$request_uri;
}
```

**Obtener certificado SSL gratuito con Let's Encrypt:**
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d tudominio.com -d www.tudominio.com
sudo certbot renew --dry-run  # Test auto-renewal
```

**Opción 2: Cloudflare (Más fácil)**
1. Agregar dominio a Cloudflare
2. Activar SSL/TLS (modo "Full" o "Full Strict")
3. Automático y gratis

**Opción 3: En Node.js directamente**
```javascript
const https = require('https');
const fs = require('fs');

const options = {
    key: fs.readFileSync('/path/to/private-key.pem'),
    cert: fs.readFileSync('/path/to/certificate.pem')
};

https.createServer(options, app).listen(443);
```

### 5. Row Level Security (RLS) en Supabase 🔐

**IMPORTANTE:** Actualmente usas `supabaseAdmin` que **bypasea RLS**. Para seguridad completa, necesitas configurar RLS.

#### Políticas Recomendadas:

**Tabla: `albums`**
```sql
-- Habilitar RLS
ALTER TABLE albums ENABLE ROW LEVEL SECURITY;

-- Solo el fotógrafo puede ver sus álbumes
CREATE POLICY "Fotógrafos ven solo sus álbumes"
ON albums FOR SELECT
USING (auth.uid() = photographer_user_id);

-- Solo el fotógrafo puede crear álbumes
CREATE POLICY "Fotógrafos crean sus álbumes"
ON albums FOR INSERT
WITH CHECK (auth.uid() = photographer_user_id);

-- Solo el fotógrafo puede actualizar sus álbumes
CREATE POLICY "Fotógrafos actualizan sus álbumes"
ON albums FOR UPDATE
USING (auth.uid() = photographer_user_id);

-- Solo el fotógrafo puede eliminar sus álbumes
CREATE POLICY "Fotógrafos eliminan sus álbumes"
ON albums FOR DELETE
USING (auth.uid() = photographer_user_id);
```

**Tabla: `photos`**
```sql
-- Habilitar RLS
ALTER TABLE photos ENABLE ROW LEVEL SECURITY;

-- Todos pueden ver fotos con marca de agua (watermarked_file_path)
CREATE POLICY "Todos ven fotos con marca de agua"
ON photos FOR SELECT
USING (true);

-- Solo el fotógrafo del álbum puede insertar fotos
CREATE POLICY "Fotógrafos suben fotos a sus álbumes"
ON photos FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM albums
        WHERE albums.id = photos.album_id
        AND albums.photographer_user_id = auth.uid()
    )
);
```

**Tabla: `orders`**
```sql
-- Habilitar RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Los clientes ven solo sus órdenes (por email)
CREATE POLICY "Clientes ven sus órdenes"
ON orders FOR SELECT
USING (customer_email = auth.email());

-- Cualquiera puede crear órdenes
CREATE POLICY "Crear órdenes es público"
ON orders FOR INSERT
WITH CHECK (true);

-- Solo el dueño puede actualizar su orden
CREATE POLICY "Actualizar propias órdenes"
ON orders FOR UPDATE
USING (customer_email = auth.email());
```

**Tabla: `order_items`**
```sql
-- Habilitar RLS
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- Ver items solo si eres dueño de la orden
CREATE POLICY "Ver items de propias órdenes"
ON order_items FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM orders
        WHERE orders.id = order_items.order_id
        AND orders.customer_email = auth.email()
    )
);
```

**Storage Buckets:**
```sql
-- Bucket: original-photos (PRIVADO)
-- Solo accesible con service role key
-- URLs firmadas para descarga

-- Bucket: watermarked-photos (PÚBLICO)
-- Acceso de lectura para todos
-- Solo el fotógrafo puede subir
```

#### Aplicar RLS en tu código:

1. **Para operaciones de fotógrafos autenticados:**
```javascript
// Usar el cliente regular con el token del usuario
const token = req.headers.authorization?.replace('Bearer ', '');
const supabaseWithAuth = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
});

// Ahora las queries respetarán RLS
const { data } = await supabaseWithAuth.from('albums').select('*');
```

2. **Para operaciones públicas (galería):**
```javascript
// Usar el cliente anon (ya respeta RLS)
const { data } = await supabase.from('photos').select('*');
```

3. **Para operaciones administrativas (webhooks):**
```javascript
// Seguir usando supabaseAdmin (bypasea RLS)
const { data } = await supabaseAdmin.from('orders').update(...);
```

## 🔍 Verificar Seguridad

### Test de Rate Limiting:
```bash
# Hacer múltiples requests rápidamente
for i in {1..10}; do curl http://localhost:3000/api/monitoring/health; done
```

### Test de CORS:
```bash
# Debería bloquear origen no permitido
curl -H "Origin: https://malicioso.com" \
     -H "Access-Control-Request-Method: POST" \
     -X OPTIONS http://localhost:3000/login
```

### Test de Headers de Seguridad:
```bash
curl -I http://localhost:3000
# Deberías ver headers como X-Content-Type-Options, X-Frame-Options, etc.
```

## 📋 Checklist de Producción

- [ ] Configurar `ALLOWED_ORIGINS` en `.env` con dominios reales
- [ ] Habilitar HTTPS con certificado SSL
- [ ] Configurar RLS en todas las tablas de Supabase
- [ ] Cambiar `NODE_ENV=production`
- [ ] Revisar logs para requests bloqueados por rate limit
- [ ] Monitorear el panel de seguridad en `/admin/monitoring.html`
- [ ] Configurar firewall en el servidor (UFW en Ubuntu)
- [ ] Deshabilitar endpoints de testing en producción
- [ ] Configurar backups automáticos diarios
- [ ] Implementar autenticación de 2 factores (opcional)

## 🚨 Respuesta a Incidentes

Si detectas actividad sospechosa:

1. **Revisar logs:** `/admin/monitoring.html` → Tab "Logs"
2. **Ver métricas:** Revisar errores por IP
3. **Bloquear IP manualmente:** Agregar a lista negra en firewall
4. **Aumentar rate limits:** Temporalmente si es ataque
5. **Rotar secrets:** Cambiar tokens de API si fueron comprometidos

## 📚 Referencias

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- [Let's Encrypt Docs](https://letsencrypt.org/docs/)

---

**Estado actual:** ✅ Rate limiting, CORS y Helmet implementados
**Pendiente:** HTTPS en producción y RLS en Supabase
