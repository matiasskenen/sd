// static_test_server.js

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080; // Usamos un puerto diferente para no colisionar con tu backend principal

// Sirve los archivos estáticos desde la carpeta 'public'
// Esto permitirá que 'simple_payment_test.html' y otros archivos HTML/JS/CSS
// dentro de 'public' sean accesibles directamente.
app.use(express.static(path.join(__dirname, 'public')));

// Ruta para la página de prueba principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'simple_payment_test.html'));
});

// Iniciar el servidor estático
app.listen(PORT, () => {
    console.log(`Servidor de prueba estático escuchando en http://localhost:${PORT}`);
    console.log(`Abre http://localhost:${PORT}/simple_payment_test.html en tu navegador.`);
    console.log('Asegúrate de que tu backend principal (server.js) esté también corriendo en http://localhost:3000');
    console.log('Y que ngrok esté activo para tu backend principal.');
});
