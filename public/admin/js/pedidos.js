export function init() {
  console.log("Pedidos cargados");

  const BACKEND_URL = window.BACKEND_URL || "";
  const ordersTableBody = document.getElementById("ordersTableBody");

  const fetchOrders = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/orders`);
      const data = await res.json();

      if (res.ok && Array.isArray(data.orders)) {
        if (data.orders.length === 0) {
          ordersTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">No hay pedidos.</td></tr>`;
          return;
        }

        ordersTableBody.innerHTML = "";
        data.orders.forEach(order => {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td class="py-3 px-4">${order.id}</td>
            <td class="py-3 px-4">${order.customer_name || "N/A"}</td>
            <td class="py-3 px-4">${new Date(order.date).toLocaleDateString()}</td>
            <td class="py-3 px-4">${order.status}</td>
            <td class="py-3 px-4 text-center">
              <button class="bg-green-500 hover:bg-green-600 text-white py-1 px-3 rounded" onclick="approveOrder('${order.id}')">Aprobar</button>
              <button class="bg-red-500 hover:bg-red-600 text-white py-1 px-3 rounded ml-2" onclick="rejectOrder('${order.id}')">Rechazar</button>
            </td>
          `;
          ordersTableBody.appendChild(tr);
        });
      } else {
        ordersTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-500">Error al cargar pedidos.</td></tr>`;
      }
    } catch (err) {
      ordersTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-500">Error de conexión.</td></tr>`;
      console.error(err);
    }
  };

  // Funciones globales para aprobar/rechazar
  window.approveOrder = async (id) => {
    try {
      const res = await fetch(`${BACKEND_URL}/orders/${id}/approve`, { method: "POST" });
      if (res.ok) {
        fetchOrders();
      }
    } catch (err) {
      console.error("Error al aprobar pedido:", err);
    }
  };

  window.rejectOrder = async (id) => {
    try {
      const res = await fetch(`${BACKEND_URL}/orders/${id}/reject`, { method: "POST" });
      if (res.ok) {
        fetchOrders();
      }
    } catch (err) {
      console.error("Error al rechazar pedido:", err);
    }
  };

  fetchOrders();
}
