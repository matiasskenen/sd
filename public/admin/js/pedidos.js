export function init() {
  console.log("Historial de pedidos cargado");

  const BACKEND_URL = window.BACKEND_URL || "";
  const ordersTableBody = document.getElementById("ordersTableBody");

  const fetchOrders = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/orders`);
      const data = await res.json();

      if (res.ok && Array.isArray(data.orders)) {
        if (data.orders.length === 0) {
          ordersTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">No hay pedidos registrados.</td></tr>`;
          return;
        }

        ordersTableBody.innerHTML = "";
        data.orders.forEach(order => {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td class="py-3 px-4">${order.id}</td>
            <td class="py-3 px-4">${order.customer_email || "N/A"}</td>
            <td class="py-3 px-4">${new Date(order.created_at).toLocaleDateString()}</td>
            <td class="py-3 px-4">${order.status}</td>
            <td class="py-3 px-4 text-right">$${order.total_amount?.toFixed(2) || "0.00"}</td>
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

  fetchOrders();
}
