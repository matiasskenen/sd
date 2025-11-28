/**
 * Script de testing para registro de fotógrafos
 * Ejecutar con: node test-register.js
 */

const testData = {
    email: "test@test.com",
    password: "password123",
    businessName: "Test Studio",
    displayName: "Test Photographer",
    phone: "+54 9 11 1234-5678"
};

console.log("🧪 Testing photographer registration...");
console.log("📋 Test data:", testData);

fetch("http://localhost:3000/auth/register", {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
    },
    body: JSON.stringify(testData),
})
    .then((response) => {
        console.log("\n📡 Response status:", response.status);
        return response.json();
    })
    .then((data) => {
        console.log("\n✅ Response data:");
        console.log(JSON.stringify(data, null, 2));

        if (data.photographer) {
            console.log("\n🎉 Registration successful!");
            console.log("👤 Photographer ID:", data.photographer.id);
            console.log("🏢 Business:", data.photographer.business_name);
            console.log("🔗 Slug:", data.photographer.slug);
            console.log("📅 Trial ends:", data.photographer.trial_ends_at);
        }
    })
    .catch((error) => {
        console.error("\n❌ Error:", error.message);
    });
