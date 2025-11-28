// Detectar automáticamente si estamos en local o producción
window.BACKEND_URL = window.location.hostname === "localhost" 
    ? "http://localhost:3000"
    : "https://school-photos-backend.onrender.com";
