// security-test.js - Script para verificar medidas de seguridad

const BASE_URL = 'http://localhost:3000';

console.log('🔒 Testing Security Measures\n');
console.log('='.repeat(60));

// Test 1: Headers de Seguridad
async function testSecurityHeaders() {
    console.log('\n1️⃣  Testing Security Headers...');
    
    try {
        const response = await fetch(BASE_URL);
        const headers = response.headers;
        
        const securityHeaders = {
            'x-content-type-options': headers.get('x-content-type-options'),
            'x-frame-options': headers.get('x-frame-options'),
            'x-xss-protection': headers.get('x-xss-protection'),
            'x-dns-prefetch-control': headers.get('x-dns-prefetch-control')
        };
        
        console.log('   Headers encontrados:');
        Object.entries(securityHeaders).forEach(([key, value]) => {
            const status = value ? '✅' : '❌';
            console.log(`   ${status} ${key}: ${value || 'NOT SET'}`);
        });
        
    } catch (err) {
        console.error('   ❌ Error:', err.message);
    }
}

// Test 2: Rate Limiting
async function testRateLimiting() {
    console.log('\n2️⃣  Testing Rate Limiting (General)...');
    console.log('   Haciendo 10 requests rápidos...\n');
    
    let blocked = 0;
    const promises = [];
    
    for (let i = 1; i <= 10; i++) {
        promises.push(
            fetch(`${BASE_URL}/status`)
                .then(res => {
                    if (res.status === 429) {
                        blocked++;
                        console.log(`   Request ${i}: ⛔ BLOCKED (429 Too Many Requests)`);
                    } else {
                        console.log(`   Request ${i}: ✅ OK (${res.status})`);
                    }
                    return res.status;
                })
                .catch(err => {
                    console.log(`   Request ${i}: ❌ Error - ${err.message}`);
                })
        );
        
        // Pequeño delay para no saturar
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    await Promise.all(promises);
    
    console.log(`\n   Resultado: ${blocked > 0 ? '✅' : '⚠️'} ${blocked} requests bloqueados`);
    console.log('   Nota: Si todos pasan, el rate limit (100/15min) no se alcanzó');
}

// Test 3: Auth Rate Limiting
async function testAuthRateLimiting() {
    console.log('\n3️⃣  Testing Auth Rate Limiting (Login)...');
    console.log('   Simulando 6 intentos de login...\n');
    
    let blocked = 0;
    
    for (let i = 1; i <= 6; i++) {
        try {
            const res = await fetch(`${BASE_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    email: 'test@test.com', 
                    password: 'wrongpassword' 
                })
            });
            
            if (res.status === 429) {
                blocked++;
                console.log(`   Intento ${i}: ⛔ BLOCKED (429) - Rate limit activado!`);
            } else {
                console.log(`   Intento ${i}: ✅ Permitido (${res.status})`);
            }
        } catch (err) {
            console.log(`   Intento ${i}: ❌ Error - ${err.message}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`\n   Resultado: ${blocked > 0 ? '✅' : '⚠️'} ${blocked} intentos bloqueados después del límite (5)`);
}

// Test 4: CORS
async function testCORS() {
    console.log('\n4️⃣  Testing CORS Configuration...');
    
    try {
        const response = await fetch(BASE_URL, {
            method: 'OPTIONS',
            headers: {
                'Origin': 'http://localhost:3000',
                'Access-Control-Request-Method': 'POST'
            }
        });
        
        const corsHeaders = {
            'access-control-allow-origin': response.headers.get('access-control-allow-origin'),
            'access-control-allow-credentials': response.headers.get('access-control-allow-credentials'),
            'access-control-allow-methods': response.headers.get('access-control-allow-methods')
        };
        
        console.log('   CORS Headers:');
        Object.entries(corsHeaders).forEach(([key, value]) => {
            const status = value ? '✅' : '❌';
            console.log(`   ${status} ${key}: ${value || 'NOT SET'}`);
        });
        
    } catch (err) {
        console.error('   ❌ Error:', err.message);
    }
}

// Test 5: Sanitización de Logs
async function testLogSanitization() {
    console.log('\n5️⃣  Testing Log Sanitization...');
    console.log('   Verificando que datos sensibles no aparezcan en logs...');
    
    try {
        // Intentar login con datos sensibles
        await fetch(`${BASE_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                email: 'test@test.com', 
                password: 'super_secret_password_123',
                token: 'sensitive_token_abc',
                api_key: 'my_api_key'
            })
        });
        
        // Esperar un momento para que se procese
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Obtener logs
        const logsRes = await fetch(`${BASE_URL}/api/monitoring/logs?limit=10`);
        const logsData = await logsRes.json();
        
        let foundSensitive = false;
        const sensitiveTerms = ['super_secret_password', 'sensitive_token', 'my_api_key'];
        
        logsData.logs.forEach(log => {
            const logStr = JSON.stringify(log);
            sensitiveTerms.forEach(term => {
                if (logStr.includes(term)) {
                    foundSensitive = true;
                }
            });
        });
        
        if (foundSensitive) {
            console.log('   ❌ FALLO: Se encontraron datos sensibles en los logs!');
        } else {
            console.log('   ✅ ÉXITO: Los logs están sanitizados correctamente');
        }
        
    } catch (err) {
        console.error('   ❌ Error:', err.message);
    }
}

// Ejecutar todos los tests
async function runAllTests() {
    await testSecurityHeaders();
    await testRateLimiting();
    await testAuthRateLimiting();
    await testCORS();
    await testLogSanitization();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Tests de seguridad completados\n');
    console.log('📋 Resumen:');
    console.log('   - Security Headers: Verificar que estén presentes');
    console.log('   - Rate Limiting: Debe bloquear después de límites');
    console.log('   - Auth Rate Limit: Debe bloquear al 6to intento');
    console.log('   - CORS: Debe estar configurado correctamente');
    console.log('   - Log Sanitization: Datos sensibles deben estar ocultos');
    console.log('\n💡 Tip: Revisa /admin/monitoring.html para ver logs en tiempo real');
}

runAllTests().catch(err => {
    console.error('❌ Error fatal en tests:', err);
    process.exit(1);
});
