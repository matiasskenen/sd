# 🚀 REFACTORING MULTI-TENANT - RESUMEN DE CAMBIOS

## ✅ Cambios Implementados

### 1. **Middleware de Autenticación** (`middleware/auth.js`)
- ✅ `requireAuth()`: Middleware para proteger endpoints (verifica JWT + subscription)
- ✅ `optionalAuth()`: Middleware opcional que agrega datos del fotógrafo si está autenticado
- ✅ Verificación de estado de suscripción (trial/active)
- ✅ Obtiene `photographer_id` automáticamente del token JWT

### 2. **Endpoints del Servidor Refactorizados** (`server.js`)

#### Álbumes:
- ✅ `GET /albums` - Ahora filtra por `photographer_id` (requiere auth)
- ✅ `POST /albums` - Crea álbumes asociados al fotógrafo autenticado
- ✅ `POST /upload-photos/:albumId` - Verifica ownership del álbum antes de subir
- ✅ `GET /albums-with-photos` - Solo muestra álbumes del fotógrafo autenticado
- ✅ `DELETE /albums/:id` - Verifica que el álbum pertenezca al fotógrafo

#### Estadísticas:
- ✅ `GET /admin/stats` - Calcula stats filtradas por `photographer_id`:
  - Total de álbumes del fotógrafo
  - Total de fotos (contadas desde álbumes del fotógrafo)
  - Total de pedidos del fotógrafo
  - Total de ventas (suma de orders con status=paid)
  - Datos del fotógrafo (business_name, plan, subscription_status)

#### Pedidos (Orders):
- ✅ `GET /orders` - Solo muestra pedidos del fotógrafo autenticado
- ✅ `DELETE /orders/all` - Solo elimina pedidos del fotógrafo
- ✅ `DELETE /orders/:id` - Verifica ownership antes de eliminar
- ✅ `POST /create-payment-preference` - Asocia order al `photographer_id` obtenido de la foto

#### Fotos:
- ✅ `DELETE /photos/:id` - Verifica que la foto pertenezca a un álbum del fotógrafo

### 3. **Frontend - Utilidades de Auth** (`public/admin/js/auth-utils.js`)
- ✅ `getAuthToken()` / `setAuthToken()` - Manejo del JWT en localStorage
- ✅ `getPhotographer()` / `setPhotographer()` - Datos del fotógrafo en localStorage
- ✅ `authenticatedFetch()` - Wrapper de fetch que agrega automáticamente `Authorization: Bearer <token>`
- ✅ `requireAuth()` - Verifica autenticación y redirige al login si no hay token
- ✅ `logout()` - Limpia sesión y redirige al login

### 4. **Frontend - Dashboard Actualizado** (`public/admin/js/dashboard.js`)
- ✅ Usa `requireAuth()` para proteger la página
- ✅ Usa `authenticatedFetch()` para llamar a `/admin/stats`
- ✅ Muestra nombre del fotógrafo desde localStorage
- ✅ Muestra total de ventas si está disponible

### 5. **Frontend - Registro** (`public/register.html`)
- ✅ Guarda `auth_token` en localStorage después del registro exitoso
- ✅ Guarda datos del `photographer` en localStorage
- ✅ Valores por defecto para testing (test@test.com, password123, etc.)
- ✅ Autocompletado en campos del formulario

### 6. **Archivo de Test** (`test-register.js`)
- ✅ Script Node.js para probar registro desde consola
- ✅ Usa datos de prueba predefinidos
- ✅ Muestra respuesta formateada con colores

---

## ⚠️ Pendiente de Implementar

### 1. **Frontend - Actualizar Fetch en Álbumes**
Los siguientes archivos necesitan usar `authenticatedFetch()` en lugar de `fetch()`:

- `public/admin/js/albumes.js` - 7 llamadas a `fetch()`:
  - Línea 69: `GET /albums`
  - Línea 109: `POST /albums`
  - Línea 317: `POST /upload-photos/:albumId`
  - Línea 366: `GET /albums-with-photos`
  - Línea 578: `DELETE /albums/:albumId`
  - Línea 624: `PUT/PATCH /albums/:id`
  - Línea 647: `DELETE /photos/:photoId`

- `public/admin/js/pedidos.js` - Todas las llamadas fetch necesitan auth

### 2. **Frontend - Página de Login**
- Crear `public/admin/login.html` funcional
- Llamar a `POST /auth/login`
- Guardar `auth_token` en localStorage
- Redirigir al dashboard

### 3. **Frontend - Verificar Sesión al Cargar**
- `public/admin/admin_dashboard.html` debe verificar `requireAuth()` al inicio
- Mostrar botón de "Cerrar Sesión"
- Mostrar nombre del fotógrafo en navbar

### 4. **RLS (Row Level Security) - Activar en Supabase**
Aunque las policies ya están creadas en la migración, hay que **activar RLS** en:
- ✅ `photographers` - Ya habilitado en migración
- ✅ `albums` - Ya habilitado en migración
- ❌ `photos` - Falta habilitar y crear policies
- ❌ `orders` - Falta habilitar y crear policies
- ❌ `order_items` - Falta habilitar y crear policies

### 5. **Endpoints Públicos (Sin Auth)**
Los siguientes endpoints deben ser **públicos** (para clientes que compran fotos):
- `GET /albums/:albumId/photos` - Ver fotos con watermark
- `POST /create-payment-preference` - Crear orden de compra
- `GET /order-details/:orderId/:customerEmail` - Ver detalles de su orden
- `GET /download-photo/:photoId/:orderId/:customerEmail` - Descargar foto comprada

Estos ya funcionan sin auth, pero hay que verificar que no rompan con los cambios.

---

## 🔧 Cómo Continuar

### Paso 1: Actualizar Frontend de Álbumes
```javascript
// En albumes.js, reemplazar todas las llamadas fetch() con authenticatedFetch()
// Ejemplo:
// Antes:
const response = await fetch(`${BACKEND_URL}/albums`);

// Después:
import { authenticatedFetch } from "./auth-utils.js";
const response = await authenticatedFetch(`${BACKEND_URL}/albums`);
```

### Paso 2: Probar el Flujo Completo
1. Registrar nuevo fotógrafo en `/register.html`
2. Verificar que se guarde el token en localStorage
3. Ir al dashboard y verificar que carguen las stats
4. Crear un álbum
5. Subir fotos al álbum
6. Verificar que todo esté filtrado por el `photographer_id` correcto

### Paso 3: Crear Página de Login
```html
<!-- login.html -->
<form id="login-form">
  <input type="email" name="email" required>
  <input type="password" name="password" required>
  <button type="submit">Iniciar Sesión</button>
</form>

<script>
import { setAuthToken, setPhotographer } from "./js/auth-utils.js";

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  
  const response = await fetch(`${BACKEND_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: formData.get("email"),
      password: formData.get("password")
    })
  });
  
  const data = await response.json();
  
  if (response.ok) {
    setAuthToken(data.session.access_token);
    setPhotographer(data.photographer);
    window.location.href = "/admin/admin_dashboard.html";
  } else {
    alert(data.error);
  }
});
</script>
```

---

## 📊 Estado del Proyecto

| Componente | Estado | Notas |
|-----------|--------|-------|
| Base de datos multi-tenant | ✅ Completo | Migración 001 ejecutada |
| Auth middleware | ✅ Completo | requireAuth + optionalAuth |
| Endpoints backend | ✅ Completo | Todos filtrados por photographer_id |
| Auth utils frontend | ✅ Completo | auth-utils.js creado |
| Dashboard JS | ✅ Actualizado | Usa authenticatedFetch |
| Registro HTML | ✅ Actualizado | Guarda token |
| Álbumes JS | ⚠️ Parcial | Falta reemplazar fetch() |
| Pedidos JS | ❌ Pendiente | No actualizado |
| Login HTML | ❌ Pendiente | No existe funcional |
| RLS en photos/orders | ⚠️ Parcial | Falta activar |

---

## 🎯 Próximos Pasos Recomendados

1. **URGENTE**: Actualizar `albumes.js` y `pedidos.js` para usar `authenticatedFetch`
2. **ALTA**: Crear página de login funcional
3. **MEDIA**: Activar RLS en tablas `photos` y `orders`
4. **MEDIA**: Crear policies RLS para `photos` y `orders`
5. **BAJA**: Agregar botón de logout en navbar
6. **BAJA**: Agregar manejo de errores 401/403 en frontend
7. **BAJA**: Crear dashboard para ver estado de suscripción

---

## 🐛 Posibles Problemas

### Error: "No autorizado"
- **Causa**: Token JWT expiró o no se envió
- **Solución**: Verificar que `authenticatedFetch()` esté siendo usado y que el token esté en localStorage

### Error: "Fotógrafo no encontrado"
- **Causa**: El `auth_user_id` no tiene un registro en `photographers`
- **Solución**: Verificar que el registro haya creado el photographer correctamente

### Error: "Suscripción inactiva"
- **Causa**: El trial expiró o la suscripción no está active
- **Solución**: Actualizar `subscription_status` o `trial_ends_at` en la tabla `photographers`

### Dashboard muestra 0 en todo
- **Causa**: El fotógrafo no tiene álbumes/fotos/pedidos aún
- **Solución**: Crear datos de prueba o verificar que photographer_id esté correcto

---

## 📝 Notas Importantes

- ✅ El campo `photographer_user_id` en `albums` ahora es `photographer_id` (corregido en migration)
- ✅ Los orders ahora se asocian automáticamente al `photographer_id` desde las fotos del carrito
- ✅ El precio por defecto de fotos se toma de `photographer.default_price_per_photo` (1500 centavos = $15 ARS)
- ⚠️ NODE_ENV debe estar en "development" para que CORS permita localhost
- ⚠️ En producción, agregar los dominios reales a `ALLOWED_ORIGINS` en .env

