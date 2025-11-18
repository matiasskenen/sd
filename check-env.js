// Script para verificar variables de entorno de Mercado Pago
// Solo muestra información masked para seguridad

const maskSecret = (value) => {
    if (!value) return 'UNDEFINED';
    if (value.length <= 8) return '****';
    const first4 = value.substring(0, 4);
    const last4 = value.substring(value.length - 4);
    const masked = '*'.repeat(value.length - 8);
    return `${first4}${masked}${last4}`;
};

console.log('\n='.repeat(80));
console.log('VERIFICACIÓN DE VARIABLES DE ENTORNO - MERCADO PAGO');
console.log('='.repeat(80));

// Detectar entorno
const isRender = process.env.RENDER === 'true' || process.env.RENDER_SERVICE_NAME;
const environment = isRender ? 'RENDER (Producción)' : 'LOCAL';

console.log(`\n📍 Entorno detectado: ${environment}`);
if (isRender) {
    console.log(`   Service: ${process.env.RENDER_SERVICE_NAME || 'N/A'}`);
}

console.log('\n' + '-'.repeat(80));
console.log('MERCADOPAGO_ACCESS_TOKEN:');
console.log(`   Valor masked: ${maskSecret(process.env.MERCADOPAGO_ACCESS_TOKEN)}`);
console.log(`   Longitud: ${process.env.MERCADOPAGO_ACCESS_TOKEN?.length || 0} caracteres`);
console.log(`   Definida: ${process.env.MERCADOPAGO_ACCESS_TOKEN ? '✅ SÍ' : '❌ NO'}`);

console.log('\n' + '-'.repeat(80));
console.log('MERCADOPAGO_PUBLIC_KEY:');
console.log(`   Valor masked: ${maskSecret(process.env.MERCADOPAGO_PUBLIC_KEY)}`);
console.log(`   Longitud: ${process.env.MERCADOPAGO_PUBLIC_KEY?.length || 0} caracteres`);
console.log(`   Definida: ${process.env.MERCADOPAGO_PUBLIC_KEY ? '✅ SÍ' : '❌ NO'}`);

console.log('\n' + '-'.repeat(80));
console.log('MERCADOPAGO_WEBHOOK_SECRET:');
console.log(`   Valor masked: ${maskSecret(process.env.MERCADOPAGO_WEBHOOK_SECRET)}`);
console.log(`   Longitud: ${process.env.MERCADOPAGO_WEBHOOK_SECRET?.length || 0} caracteres`);
console.log(`   Definida: ${process.env.MERCADOPAGO_WEBHOOK_SECRET ? '✅ SÍ' : '❌ NO'}`);

console.log('\n' + '='.repeat(80));
console.log('✅ Verificación completada');
console.log('='.repeat(80) + '\n');
