// Manejo de navegación
document.addEventListener("DOMContentLoaded", () => {
  const links = document.querySelectorAll(".nav-link");
  const content = document.getElementById("content");

  const loadSection = async (page) => {
    try {
      const res = await fetch(`/admin/partials/${page}.html`);
      if (!res.ok) throw new Error("No se pudo cargar la sección");
      content.innerHTML = await res.text();

      // Cargar lógica específica
      import(`/admin/js/${page}.js`).then(module => {
        if (module.init) module.init();
      }).catch(err => console.error(`Error cargando JS de ${page}:`, err));

    } catch (err) {
      content.innerHTML = `<p class="text-red-500">Error al cargar la sección: ${err.message}</p>`;
    }
  };

  // Eventos de menú
  links.forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const page = link.dataset.page;
      loadSection(page);
    });
  });

  // Cargar Dashboard por defecto
  loadSection("dashboard");

  // Logout
  document.getElementById("logoutButton").addEventListener("click", () => {
    window.location.href = "/login.html";
  });
});
