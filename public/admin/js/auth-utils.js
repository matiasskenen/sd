/**
 * Utilidades para autenticación y manejo de sesión
 */

// Obtener token JWT del localStorage
export function getAuthToken() {
    return localStorage.getItem("auth_token");
}

// Guardar token JWT en localStorage
export function setAuthToken(token) {
    localStorage.setItem("auth_token", token);
}

// Eliminar token JWT
export function clearAuthToken() {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("photographer");
}

// Obtener datos del fotógrafo del localStorage
export function getPhotographer() {
    const data = localStorage.getItem("photographer");
    return data ? JSON.parse(data) : null;
}

// Guardar datos del fotógrafo
export function setPhotographer(photographer) {
    localStorage.setItem("photographer", JSON.stringify(photographer));
}

// Verificar si está autenticado
export function isAuthenticated() {
    return !!getAuthToken();
}

// Hacer fetch con auth automático
export async function authenticatedFetch(url, options = {}) {
    const token = getAuthToken();

    if (!token) {
        throw new Error("No autenticado");
    }

    const headers = {
        ...options.headers,
        Authorization: `Bearer ${token}`,
    };

    const response = await fetch(url, {
        ...options,
        headers,
    });

    // Si el token expiró, redirigir al login
    if (response.status === 401) {
        clearAuthToken();
        window.location.href = "/admin/login.html";
        throw new Error("Sesión expirada");
    }

    return response;
}

// Logout
export function logout() {
    clearAuthToken();
    window.location.href = "/admin/login.html";
}

// Verificar autenticación en páginas protegidas
export function requireAuth() {
    if (!isAuthenticated()) {
        window.location.href = "/admin/login.html";
        return false;
    }
    return true;
}
