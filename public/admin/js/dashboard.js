import { requireAuth, authenticatedFetch, getPhotographer } from "./auth-utils.js";

export function init() {
    console.log("Dashboard cargado");

    // Verificar autenticación
    if (!requireAuth()) return;

    const BACKEND_URL = window.BACKEND_URL || "";
    const photographer = getPhotographer();

    const totalAlbumsEl = document.getElementById("totalAlbums");
    const totalPhotosEl = document.getElementById("totalPhotos");
    const totalOrdersEl = document.getElementById("totalOrders");

    // Mostrar nombre del fotógrafo si hay elemento para ello
    const photographerNameEl = document.getElementById("photographerName");
    if (photographerNameEl && photographer) {
        photographerNameEl.textContent = photographer.display_name || photographer.business_name;
    }

    const fetchStats = async () => {
        try {
            const res = await authenticatedFetch(`${BACKEND_URL}/admin/stats`);
            const data = await res.json();
            if (res.ok) {
                totalAlbumsEl.textContent = data.totalAlbums ?? 0;
                totalPhotosEl.textContent = data.totalPhotos ?? 0;
                totalOrdersEl.textContent = data.totalOrders ?? 0;

                // Mostrar ventas totales si existe el elemento
                const totalSalesEl = document.getElementById("totalSales");
                if (totalSalesEl && data.totalSales) {
                    totalSalesEl.textContent = `$${data.totalSales}`;
                }
            } else {
                console.error("Error al obtener estadísticas:", data.message);
            }
        } catch (err) {
            console.error("Error de conexión al cargar estadísticas:", err);
        }
    };

    fetchStats();
}
