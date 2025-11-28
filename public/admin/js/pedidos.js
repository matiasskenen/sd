import { requireAuth, authenticatedFetch } from "./auth-utils.js";

export function init() {
  console.log("Historial de pedidos cargado");

  // Verificar autenticación
  if (!requireAuth()) return;

  const BACKEND_URL = window.BACKEND_URL || "";
  const ordersTableBody = document.getElementById("ordersTableBody");
  const filterOrderDate = document.getElementById("filterOrderDate");
  const clearDateFilter = document.getElementById("clearDateFilter");
  const deleteAllOrders = document.getElementById("deleteAllOrders");

  let allOrdersData = [];

  const fetchOrders = async () => {
    try {
      const res = await authenticatedFetch(`${BACKEND_URL}/orders`);
      const data = await res.json();

      if (res.ok && Array.isArray(data.orders)) {
        allOrdersData = data.orders;
        renderOrders(allOrdersData);
      } else {
        ordersTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-red-500">Error al cargar pedidos.</td></tr>`;
      }
    } catch (err) {
      ordersTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-red-500">Error de conexión.</td></tr>`;
      console.error(err);
    }
  };

  const renderOrders = (orders) => {
    if (orders.length === 0) {
      ordersTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">No hay pedidos que coincidan con el filtro.</td></tr>`;
      return;
    }

    ordersTableBody.innerHTML = "";
    orders.forEach(order => {
      const tr = document.createElement("tr");
      tr.className = "border-b hover:bg-gray-50";
      tr.innerHTML = `
        <td class="py-3 px-4">${order.id}</td>
        <td class="py-3 px-4">${order.customer_email || "N/A"}</td>
        <td class="py-3 px-4">${new Date(order.created_at).toLocaleDateString()}</td>
        <td class="py-3 px-4">${order.status}</td>
        <td class="py-3 px-4 text-right">$${order.total_amount?.toFixed(2) || "0.00"}</td>
        <td class="py-3 px-4 text-center">
          <button 
            class="bg-red-500 hover:bg-red-600 text-white w-8 h-8 rounded-full flex items-center justify-center shadow delete-order mx-auto"
            data-order-id="${order.id}"
            title="Eliminar pedido"
          >
            <i class="fas fa-trash-alt text-sm"></i>
          </button>
        </td>
      `;
      ordersTableBody.appendChild(tr);
    });

    // Listeners para eliminar pedidos individuales
    document.querySelectorAll(".delete-order").forEach(btn => {
      btn.addEventListener("click", async () => {
        const orderId = btn.dataset.orderId;
        if (confirm(`¿Seguro que quieres eliminar el pedido #${orderId}?`)) {
          await deleteOrder(orderId);
        }
      });
    });
  };

  const filterOrders = () => {
    const filterDate = filterOrderDate.value;

    if (!filterDate) {
      renderOrders(allOrdersData);
      return;
    }

    const filtered = allOrdersData.filter(order => {
      const orderDate = new Date(order.created_at).toISOString().split('T')[0];
      return orderDate === filterDate;
    });

    renderOrders(filtered);
  };

  const deleteOrder = async (orderId) => {
    try {
      const res = await authenticatedFetch(`${BACKEND_URL}/orders/${orderId}`, {
        method: "DELETE"
      });

      if (res.ok) {
        alert("Pedido eliminado exitosamente.");
        await fetchOrders();
      } else {
        const data = await res.json();
        alert(`Error al eliminar pedido: ${data.message}`);
      }
    } catch (err) {
      console.error(err);
      alert("Error de conexión al eliminar pedido.");
    }
  };

  const deleteAllOrdersFunc = async () => {
    if (!confirm("⚠️ ¿Estás SEGURO que quieres eliminar TODOS los pedidos? Esta acción no se puede deshacer.")) {
      return;
    }

    if (!confirm("⚠️ ÚLTIMA CONFIRMACIÓN: Se eliminarán todos los pedidos permanentemente.")) {
      return;
    }

    try {
      const res = await authenticatedFetch(`${BACKEND_URL}/orders/all`, {
        method: "DELETE"
      });

      if (res.ok) {
        alert("Todos los pedidos han sido eliminados.");
        await fetchOrders();
      } else {
        const data = await res.json();
        alert(`Error al eliminar pedidos: ${data.message}`);
      }
    } catch (err) {
      console.error(err);
      alert("Error de conexión al eliminar pedidos.");
    }
  };

  // Event Listeners
  filterOrderDate.addEventListener("change", filterOrders);
  
  clearDateFilter.addEventListener("click", () => {
    filterOrderDate.value = "";
    renderOrders(allOrdersData);
  });

  deleteAllOrders.addEventListener("click", deleteAllOrdersFunc);

  fetchOrders();
}
