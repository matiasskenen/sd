export function init() {
  console.log("Dashboard cargado");

  const BACKEND_URL = window.BACKEND_URL || "";

  const totalAlbumsEl = document.getElementById("totalAlbums");
  const totalPhotosEl = document.getElementById("totalPhotos");
  const totalOrdersEl = document.getElementById("totalOrders");

  const fetchStats = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/admin/stats`);
      const data = await res.json();
      if (res.ok) {
        totalAlbumsEl.textContent = data.totalAlbums ?? 0;
        totalPhotosEl.textContent = data.totalPhotos ?? 0;
        totalOrdersEl.textContent = data.totalOrders ?? 0;
      } else {
        console.error("Error al obtener estadísticas:", data.message);
      }
    } catch (err) {
      console.error("Error de conexión al cargar estadísticas:", err);
    }
  };

  fetchStats();
}
