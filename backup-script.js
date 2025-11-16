// backup-script.js - Script para exportar backups de Supabase
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

// Directorio de backups
const BACKUP_DIR = path.join(__dirname, "backups");

// Crear directorio si no existe
if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

async function backupTable(tableName) {
    console.log(`📦 Exportando tabla: ${tableName}...`);
    
    try {
        const { data, error } = await supabase
            .from(tableName)
            .select("*");
        
        if (error) {
            console.error(`❌ Error exportando ${tableName}:`, error.message);
            return null;
        }
        
        console.log(`✅ ${tableName}: ${data.length} registros exportados`);
        return { table: tableName, data, count: data.length };
        
    } catch (err) {
        console.error(`❌ Error inesperado en ${tableName}:`, err.message);
        return null;
    }
}

async function createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = path.join(BACKUP_DIR, `backup-${timestamp}.json`);
    
    console.log("\n🚀 Iniciando backup de base de datos...\n");
    console.log(`📁 Archivo de destino: ${backupFile}\n`);
    
    const startTime = Date.now();
    
    // Tablas a exportar
    const tables = ["albums", "photos", "orders", "order_items", "descargas"];
    
    const backup = {
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        tables: {}
    };
    
    // Exportar cada tabla
    for (const tableName of tables) {
        const result = await backupTable(tableName);
        if (result) {
            backup.tables[tableName] = result;
        }
    }
    
    // Guardar backup
    try {
        fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2), "utf8");
        
        const fileSize = fs.statSync(backupFile).size;
        const duration = Date.now() - startTime;
        
        console.log("\n" + "=".repeat(60));
        console.log("✅ BACKUP COMPLETADO EXITOSAMENTE");
        console.log("=".repeat(60));
        console.log(`📊 Resumen:`);
        console.log(`   - Tablas exportadas: ${tables.length}`);
        console.log(`   - Registros totales: ${Object.values(backup.tables).reduce((sum, t) => sum + t.count, 0)}`);
        console.log(`   - Tamaño del archivo: ${(fileSize / 1024).toFixed(2)} KB`);
        console.log(`   - Duración: ${duration}ms`);
        console.log(`   - Archivo: ${backupFile}`);
        console.log("=".repeat(60) + "\n");
        
        // Limpiar backups antiguos (mantener últimos 7 días)
        cleanOldBackups();
        
    } catch (err) {
        console.error("\n❌ Error guardando backup:", err.message);
    }
}

function cleanOldBackups() {
    const files = fs.readdirSync(BACKUP_DIR);
    const backupFiles = files.filter(f => f.startsWith("backup-") && f.endsWith(".json"));
    
    if (backupFiles.length <= 7) {
        console.log(`📌 Manteniendo ${backupFiles.length} backups (máximo 7)`);
        return;
    }
    
    // Ordenar por fecha (más antiguos primero)
    backupFiles.sort();
    
    // Eliminar los más antiguos
    const toDelete = backupFiles.slice(0, backupFiles.length - 7);
    
    console.log(`\n🗑️  Limpiando ${toDelete.length} backups antiguos...`);
    
    toDelete.forEach(file => {
        const filePath = path.join(BACKUP_DIR, file);
        fs.unlinkSync(filePath);
        console.log(`   - Eliminado: ${file}`);
    });
}

// Ejecutar backup
createBackup().catch(err => {
    console.error("❌ Error fatal:", err);
    process.exit(1);
});
