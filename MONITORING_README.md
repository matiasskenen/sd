# Panel de Monitoreo y Debugging

Panel completo de observabilidad para tu aplicación de fotos escolares.

## 🚀 Acceso

Accede al panel desde: `http://localhost:3000/admin/monitoring.html`

O desde el Dashboard de Admin → Botón "Abrir Panel de Monitoreo"

## 📊 Características

### 1. **Logs en Tiempo Real**
- ✅ Consola visual estilo terminal
- ✅ Filtrado por nivel (DEBUG, INFO, WARN, ERROR)
- ✅ Auto-refresh cada 5 segundos
- ✅ Descarga de logs en formato JSON
- ✅ Estadísticas en tiempo real
- ✅ Metadata estructurada

**Controles:**
- **Nivel:** Filtra logs por severidad
- **Límite:** Cantidad de logs a mostrar (50-1000)
- **Auto-refresh:** Actualización automática
- **Limpiar Logs:** Borra todo el buffer
- **Descargar JSON:** Exporta logs actuales

### 2. **Métricas del Servidor**
- ✅ Total de requests
- ✅ Errores totales
- ✅ Tiempo de respuesta promedio/min/max
- ✅ Fotos subidas
- ✅ Requests por endpoint
- ✅ Status codes distribuidos
- ✅ Info del sistema (Node version, memoria, uptime)

**Acciones:**
- **Refrescar:** Obtener datos actualizados
- **Resetear:** Limpiar todas las métricas

### 3. **Testing y Debugging**

**Tests de Funcionalidad:**
- ✅ **Crear Álbum de Prueba:** Genera álbum con datos aleatorios
- ✅ **Health Check:** Verifica estado de DB y Storage
- ✅ **Limpiar Datos de Prueba:** Elimina álbumes con "Test" en el nombre

**Tests de Performance:**
- ✅ **Simular Error 500/404:** Prueba manejo de errores
- ✅ **Respuesta Lenta:** Simula delay configurable (testing de timeouts)

### 4. **Configuración**
- ✅ **Nivel de Log:** Control de verbosidad (DEBUG/INFO/WARN/ERROR)
- ✅ **Console Logging:** Habilita/deshabilita logs en consola del servidor
- ✅ Estado actual en tiempo real

## 🎯 Uso Recomendado

### Durante Desarrollo
```
1. Nivel de Log: DEBUG
2. Console Logging: Habilitado
3. Auto-refresh: Habilitado
```

### En Producción
```
1. Nivel de Log: INFO o WARN
2. Console Logging: Deshabilitado (usar solo el buffer)
3. Monitorear métricas de performance
```

## 🔒 Seguridad

El sistema de logging **sanitiza automáticamente** datos sensibles:
- Passwords
- Tokens
- API Keys
- Secrets

Cualquier campo que contenga estas palabras en su nombre será reemplazado por `***REDACTED***`

## 📡 API Endpoints

### Logs
```
GET    /api/monitoring/logs?level=INFO&limit=100
DELETE /api/monitoring/logs
POST   /api/monitoring/log-level { level: "DEBUG" }
POST   /api/monitoring/console-logging { enabled: true }
```

### Métricas
```
GET    /api/monitoring/metrics
DELETE /api/monitoring/metrics
GET    /api/monitoring/health
```

### Testing
```
POST   /api/testing/create-test-album
DELETE /api/testing/cleanup-test-data
GET    /api/testing/simulate-error?type=500
GET    /api/testing/slow-endpoint?delay=3000
```

## 💡 Tips

1. **Logs persistentes:** El buffer guarda los últimos 1000 logs en memoria. Para persistencia, descarga regularmente los logs en JSON.

2. **Debugging de webhooks:** Usa el tab de Logs con nivel DEBUG para ver todos los detalles de los webhooks de Mercado Pago.

3. **Performance:** Si notas tiempos de respuesta altos, revisa la sección de Performance en Métricas.

4. **Testing antes de deploy:** Ejecuta todos los tests de la pestaña Testing antes de cada deployment.

5. **Health checks:** Configura monitoreo externo que consulte `/api/monitoring/health` cada 5 minutos.

## 🎨 Interfaz

- **Tema oscuro** optimizado para largas sesiones
- **Fuente monoespaciada** (JetBrains Mono) para logs
- **Color coding** por nivel de severidad
- **Responsive** para móviles y tablets
- **Animaciones suaves** y feedback visual

## 🔧 Personalización

Edita los siguientes archivos:
- `public/admin/monitoring.html` - Estructura
- `public/admin/js/monitoring.js` - Lógica
- `public/admin/css/monitoring.css` - Estilos

## 📈 Métricas Tracked

El servidor automáticamente trackea:
- Requests totales y por endpoint
- Response times (promedio, min, max)
- Status codes
- Errores por tipo
- Fotos subidas/descargadas
- Álbumes creados
- Órdenes creadas/pagadas
- Uptime del servidor
- Uso de memoria

## ⚡ Performance

El sistema de logging está optimizado:
- Buffer circular (no crece infinitamente)
- Logs sanitizados antes de guardar
- Middleware de métricas con overhead mínimo
- Sin impacto en producción si console logging está deshabilitado

## 💾 Backups Automáticos

### Ejecutar Backup Manual
```bash
npm run backup
```

Este comando:
- ✅ Exporta todas las tablas (albums, photos, orders, order_items, descargas)
- ✅ Guarda en formato JSON con timestamp
- ✅ Mantiene los últimos 7 backups automáticamente
- ✅ Muestra resumen completo (tablas, registros, tamaño, duración)

### Automatizar Backups

**En Windows (Task Scheduler):**
```powershell
# Crear tarea que ejecute diariamente a las 3 AM:
schtasks /create /tn "Backup Fotos" /tr "cd C:\ruta\al\proyecto && npm run backup" /sc daily /st 03:00
```

**En Linux/Mac (Cron):**
```bash
# Editar crontab
crontab -e

# Agregar línea para backup diario a las 3 AM
0 3 * * * cd /ruta/al/proyecto && npm run backup >> /var/log/backup.log 2>&1
```

### Restaurar desde Backup
```javascript
// Ejemplo de script de restauración
const backup = require('./backups/backup-2025-11-16.json');

// Restaurar tabla específica
await supabase.from('albums').upsert(backup.tables.albums.data);
```

---

**¡Listo para usar!** 🎉
