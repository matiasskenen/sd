import { requireAuth, authenticatedFetch } from "./auth-utils.js";

export function init() {
    console.log("Sección de álbumes cargada");

    // Verificar autenticación
    if (!requireAuth()) return;

    const BACKEND_URL = window.BACKEND_URL || ""; // Config global
  
  // DOM Elements
  const albumSelectionMode = document.getElementById('albumSelectionMode');
  const albumCreationMode = document.getElementById('albumCreationMode');
  const toggleCreateNewAlbumModeButton = document.getElementById('toggleCreateNewAlbumMode');
  const confirmCreateAlbumButton = document.getElementById('confirmCreateAlbumButton');
  const cancelCreateAlbumButton = document.getElementById('cancelCreateAlbumButton');

  const uploadForm = document.getElementById('uploadForm');
  const albumSelect = document.getElementById('albumSelect');
  const newAlbumNameInput = document.getElementById('newAlbumNameInput');
  const photosInput = document.getElementById('photos');
  const photosFolderInput = document.getElementById('photosFolder');
  const selectFolderBtn = document.getElementById('selectFolderBtn');
  const photosUploadSection = document.getElementById('photosUploadSection');
  const previewContainer = document.getElementById('previewContainer');
  const uploadButton = document.getElementById('uploadButton');
  const loadingSpinner = document.getElementById('loading-spinner');
  const loadingDiv = document.getElementById('loading');
  const messageDiv = document.getElementById('message');
  const clearAlbumSelectionButton = document.getElementById('clearAlbumSelection');
  const newAlbumDateInput = document.getElementById('newAlbumDateInput');
  const newAlbumDescriptionInput = document.getElementById('newAlbumDescriptionInput');
  const newAlbumPriceInput = document.getElementById('newAlbumPriceInput');

  // Toggle Albums Section
  const toggleAlbumsSection = document.getElementById('toggleAlbumsSection');
  const toggleAlbumsIcon = document.getElementById('toggleAlbumsIcon');
  const albumsContent = document.getElementById('albumsContent');

  const showMessage = (msg, type) => {
    messageDiv.textContent = msg;
    messageDiv.className = 'message';
    messageDiv.classList.add(type);
    messageDiv.classList.remove('hidden');
  };

  const hideMessage = () => {
    messageDiv.classList.add('hidden');
    messageDiv.textContent = '';
  };

  const setLoading = (isLoading) => {
    uploadButton.disabled = isLoading;
    albumSelect.disabled = isLoading;
    newAlbumNameInput.disabled = isLoading;
    confirmCreateAlbumButton.disabled = isLoading;
    cancelCreateAlbumButton.disabled = isLoading;
    photosInput.disabled = isLoading;
    clearAlbumSelectionButton.disabled = isLoading;
    loadingSpinner.classList.toggle('hidden', !isLoading);
    loadingDiv.classList.toggle('hidden', !isLoading);
    uploadButton.textContent = isLoading ? 'Subiendo...' : 'Subir Fotos';
  };

  const fetchAlbums = async () => {
    albumSelect.innerHTML = '<option value="">Cargando álbumes...</option>';
    albumSelect.disabled = true;
    try {
      const response = await authenticatedFetch(`${BACKEND_URL}/albums`);
      const data = await response.json();
      if (response.ok) {
        albumSelect.innerHTML = '<option value="">-- Selecciona un álbum --</option>';
        if (data.albums?.length) {
          data.albums.forEach(album => {
            const option = document.createElement('option');
            option.value = album.id;
            option.textContent = album.name;
            albumSelect.appendChild(option);
          });
        } else {
          albumSelect.innerHTML += '<option value="">No hay álbumes disponibles</option>';
        }
      } else {
        showMessage(`Error al cargar álbumes: ${data.message}`, 'error');
      }
    } catch (error) {
      showMessage(`Error de conexión al cargar álbumes: ${error.message}`, 'error');
    } finally {
      albumSelect.disabled = false;
      setAlbumSelectionState();
    }
  };

const createAlbum = async () => {
  const newAlbumName = newAlbumNameInput.value.trim();
  const newAlbumDate = newAlbumDateInput?.value || new Date().toISOString().split('T')[0];
  const newAlbumDescription = newAlbumDescriptionInput?.value.trim();
  const newAlbumPrice = newAlbumPriceInput?.value || 15.0;

  if (!newAlbumName) {
    showMessage('Por favor, ingresa un nombre para el nuevo álbum.', 'error');
    return null;
  }

  setLoading(true);
  hideMessage();

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/albums`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newAlbumName,
        event_date: newAlbumDate,
        description: newAlbumDescription,
        price_per_photo: Number(newAlbumPrice)
      })
    });

    const data = await response.json();
    if (response.ok) {
      showMessage(`Álbum "${data.album.name}" creado exitosamente!`, 'success');
      newAlbumNameInput.value = '';
      newAlbumDateInput.value = '';
      newAlbumDescriptionInput.value = '';
      newAlbumPriceInput.value = '15.00';
      await fetchAlbums();
      albumSelect.value = data.album.id;
      // ✅ Volver al modo selección y MOSTRAR sección de fotos
      albumCreationMode.classList.add('hidden');
      albumSelectionMode.classList.remove('hidden');
      setAlbumSelectionState();
      // ✅ Recargar lista de álbumes existentes automáticamente
      fetchAlbumsWithPhotos();
      return data.album.id;
    } else {
      showMessage(`Error al crear álbum: ${data.message}`, 'error');
      return null;
    }
  } catch (error) {
    showMessage(`Error de conexión: ${error.message}`, 'error');
    return null;
  } finally {
    setLoading(false);
  }
};


  const setAlbumSelectionState = () => {
    const selectedAlbumId = albumSelect.value;
    if (selectedAlbumId) {
      newAlbumNameInput.disabled = true;
      confirmCreateAlbumButton.disabled = true;
      cancelCreateAlbumButton.disabled = true;
      newAlbumNameInput.value = '';
      clearAlbumSelectionButton.classList.remove('hidden');
      albumCreationMode.classList.add('hidden');
      albumSelectionMode.classList.remove('hidden');
      // ✅ MOSTRAR sección de fotos cuando se selecciona un álbum
      photosUploadSection.classList.remove('hidden');
      uploadButton.classList.remove('hidden');
    } else {
      // Solo ocultar fotos si NO estamos en modo creación de álbum
      const inCreationMode = !albumCreationMode.classList.contains('hidden');
      if (!inCreationMode) {
        albumSelect.disabled = false;
        newAlbumNameInput.disabled = false;
        toggleCreateNewAlbumModeButton.disabled = false;
        clearAlbumSelectionButton.classList.add('hidden');
        // ✅ OCULTAR sección de fotos si no hay álbum seleccionado
        photosUploadSection.classList.add('hidden');
        uploadButton.classList.add('hidden');
      }
    }
  };

  albumSelect.addEventListener('change', setAlbumSelectionState);
  clearAlbumSelectionButton.addEventListener('click', () => {
    albumSelect.value = "";
    setAlbumSelectionState();
  });
  toggleCreateNewAlbumModeButton.addEventListener('click', () => {
    albumSelect.value = "";
    albumSelectionMode.classList.add('hidden');
    albumCreationMode.classList.remove('hidden');
    albumSelect.disabled = true;
    clearAlbumSelectionButton.classList.add('hidden');
    newAlbumNameInput.disabled = false;
    confirmCreateAlbumButton.disabled = false;
    cancelCreateAlbumButton.disabled = false;
    toggleCreateNewAlbumModeButton.disabled = false;
    // ✅ OCULTAR sección de fotos al crear nuevo álbum
    photosUploadSection.classList.add('hidden');
    uploadButton.classList.add('hidden');
    previewContainer.innerHTML = ''; // limpiar previsualizaciones
    newAlbumNameInput.focus();
  });
  cancelCreateAlbumButton.addEventListener('click', () => {
    newAlbumNameInput.value = '';
    newAlbumDateInput.value = '';
    newAlbumDescriptionInput.value = '';
    albumCreationMode.classList.add('hidden');
    albumSelectionMode.classList.remove('hidden');
    albumSelect.disabled = false;
    // ✅ Volver al estado original (fotos ocultas si no hay álbum seleccionado)
    setAlbumSelectionState();
  });
  confirmCreateAlbumButton.addEventListener('click', createAlbum);

  // ✅ Listener para botón "Seleccionar carpeta completa"
  selectFolderBtn.addEventListener('click', () => {
    photosFolderInput.click(); // abre el selector de carpeta
  });

  // ✅ Listener para el input de carpeta (webkitdirectory)
  photosFolderInput.addEventListener('change', async (event) => {
    // Transferir archivos seleccionados al input principal
    const dt = new DataTransfer();
    Array.from(event.target.files).forEach(file => dt.items.add(file));
    photosInput.files = dt.files;
    // Disparar evento change en photosInput para generar previsualizaciones
    photosInput.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // ✅ Listener para el input de fotos individuales
  photosInput.addEventListener('change', async (event) => {
      previewContainer.innerHTML = '';
      const watermarkUrl = '/assets/watermark.png'; // ruta pública accesible desde el frontend

      // Cargar marca de agua como imagen (pero no romper si falla)
      const watermarkImg = new Image();
      watermarkImg.src = watermarkUrl;
      try {
        await new Promise((res, rej) => { watermarkImg.onload = res; watermarkImg.onerror = rej; });
      } catch (err) {
        console.warn('No se pudo cargar la marca de agua para la previsualización:', err);
      }

      // Helper: detectar imágenes aunque file.type esté vacío (pasa en algunas plataformas)
      const looksLikeImage = (file) => {
        if (file.type && file.type.startsWith('image/')) return true;
        return /\.(jpe?g|png|gif|bmp|webp|heic|heif|tiff)$/i.test(file.name || '');
      };

      Array.from(event.target.files).forEach(file => {
        if (!looksLikeImage(file)) {
          // mostrar un placeholder con el nombre del archivo para ayudar al usuario
          const placeholder = document.createElement('div');
          placeholder.className = 'preview-item preview-placeholder';
          placeholder.innerHTML = `<div class="placeholder-text">No es una imagen reconocida: ${file.name}</div>`;
          previewContainer.appendChild(placeholder);
          console.log('Archivo ignorado (no parece imagen):', file.name, file.type);
          return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            // Crear imagen de la foto original
            const img = new Image();
            img.src = e.target.result;
            await new Promise(res => img.onload = res);

            // Crear canvas del mismo tamaño que la foto
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;

            // Dibujar la foto original
            ctx.drawImage(img, 0, 0);

            // Si la marca de agua cargó, dibujarla proporcionalmente
            if (watermarkImg && watermarkImg.width) {
              const wmWidth = img.width * 0.25; // 25% del ancho
              const wmHeight = watermarkImg.height * (wmWidth / watermarkImg.width);
              const wmX = (img.width - wmWidth) / 2;
              const wmY = (img.height - wmHeight) / 2;
              ctx.globalAlpha = 0.5; // transparencia
              ctx.drawImage(watermarkImg, wmX, wmY, wmWidth, wmHeight);
            }

            // Crear preview
            const previewItem = document.createElement('div');
            previewItem.className = 'preview-item';
            previewItem.innerHTML = `<img src="${canvas.toDataURL('image/jpeg', 0.8)}" alt="Preview">`;
            previewContainer.appendChild(previewItem);
          } catch (err) {
            console.error('Error generando preview para', file.name, err);
            const placeholder = document.createElement('div');
            placeholder.className = 'preview-item preview-placeholder';
            placeholder.innerHTML = `<div class="placeholder-text">Error mostrando: ${file.name}</div>`;
            previewContainer.appendChild(placeholder);
          }
        };
        reader.readAsDataURL(file);
      });
    });


  uploadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    let albumIdToUse = albumSelect.value;
    if (!albumIdToUse && newAlbumNameInput.value.trim()) {
      albumIdToUse = await createAlbum();
      if (!albumIdToUse) return;
    }
    const files = photosInput.files;
    if (!albumIdToUse) return showMessage('Selecciona o crea un álbum.', 'error');
    if (files.length === 0) return showMessage('Selecciona al menos una foto.', 'error');

    setLoading(true);
    hideMessage();
    const formData = new FormData();
    Array.from(files).forEach(file => formData.append('photos', file));
    try {
      const response = await authenticatedFetch(`${BACKEND_URL}/upload-photos/${albumIdToUse}`, {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      if (response.ok) {
        showMessage(`¡${data.summary}!`, 'success');
        uploadForm.reset();
        previewContainer.innerHTML = '';
        fetchAlbums();
        // ✅ Recargar automáticamente la lista de álbumes con las nuevas fotos
        fetchAlbumsWithPhotos();
      } else {
        showMessage(`Error: ${data.message}`, 'error');
      }
    } catch (error) {
      showMessage(`Error de conexión: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  });

  // Cargar álbumes al entrar
  fetchAlbums();

  // Toggle Albums Section (collapsar/expandir)
  if (toggleAlbumsSection && toggleAlbumsIcon && albumsContent) {
    toggleAlbumsSection.addEventListener('click', () => {
      const isHidden = albumsContent.classList.contains('hidden');
      if (isHidden) {
        albumsContent.classList.remove('hidden');
        toggleAlbumsIcon.classList.add('rotate-180');
      } else {
        albumsContent.classList.add('hidden');
        toggleAlbumsIcon.classList.remove('rotate-180');
      }
    });
  }

  const albumsList = document.getElementById('albumsList');
  const searchAlbumText = document.getElementById('searchAlbumText');
  const filterAlbumDate = document.getElementById('filterAlbumDate');
  
  // Variable para almacenar todos los álbumes sin filtrar
  let allAlbumsData = [];

const fetchAlbumsWithPhotos = async () => {
  albumsList.innerHTML = `<p class="text-gray-500">Cargando álbumes...</p>`;
  try {
    const res = await authenticatedFetch(`${BACKEND_URL}/albums-with-photos`);
    const data = await res.json();

    if (res.ok && Array.isArray(data)) {
      allAlbumsData = data; // Guardar datos sin filtrar
      renderAlbums(data); // Renderizar con datos completos
    } else {
      albumsList.innerHTML = `<p class="text-red-500">Error al cargar álbumes.</p>`;
    }
  } catch (err) {
    console.error(err);
    albumsList.innerHTML = `<p class="text-red-500">Error de conexión.</p>`;
  }
};

const renderAlbums = (data) => {
  if (data.length === 0) {
    albumsList.innerHTML = `<p class="text-gray-500">No hay álbumes que coincidan con los filtros.</p>`;
    return;
  }

  albumsList.innerHTML = "";

  data.forEach(album => {
        const albumCard = document.createElement("div");
        albumCard.className = "bg-white p-4 rounded-lg shadow-md";

        // Cabecera de álbum
        const header = `
          <div class="flex justify-between items-center mb-4">
            <div>
              <h3 class="text-lg font-bold text-gray-800">${album.name}</h3>
              <p class="text-sm text-gray-500">Evento: ${album.event_date}</p>
              ${album.description ? `<p class="text-xs text-gray-400">${album.description}</p>` : ""}
              <p class="text-sm font-semibold text-green-600 mt-1">💵 Precio: $${album.price_per_photo || 15.0} por foto</p>
            </div>
            <div class="flex gap-2">
              <button class="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded edit-album" 
                data-id="${album.id}" 
                data-name="${album.name}" 
                data-date="${album.event_date}" 
                data-description="${album.description || ''}"
                data-price="${album.price_per_photo || 15.0}">
                Editar
              </button>
              <button class="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded delete-album" data-id="${album.id}">
                Eliminar
              </button>
            </div>
          </div>
        `;

        // Lista de fotos
        let photosHtml = "";
        if (album.photos?.length) {
          const maxPhotosToShow = 8;
          const photosToDisplay = album.photos.slice(0, maxPhotosToShow);
          const hasMorePhotos = album.photos.length > maxPhotosToShow;
          
          photosHtml = `
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
              ${photosToDisplay.map(photo => `
                <div class="relative group">
                  <img src="${photo.public_watermarked_url}" alt="Foto" class="w-full h-32 object-cover rounded">
                  <button 
                    class="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white w-8 h-8 rounded-full opacity-0 group-hover:opacity-100 delete-photo flex items-center justify-center shadow-lg transition-opacity"
                    data-id="${photo.id}"
                    title="Eliminar foto"
                  >
                    <i class="fas fa-trash-alt text-sm"></i>
                  </button>
                </div>
              `).join("")}
            </div>
            ${hasMorePhotos ? `
              <button 
                class="mt-4 bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded view-all-photos"
                data-album-id="${album.id}"
                data-album-name="${album.name}"
              >
                Ver todas las fotos (${album.photos.length})
              </button>
            ` : ''}
          `;
        } else {
          photosHtml = `<p class="text-gray-400">No hay fotos en este álbum.</p>`;
        }

    albumCard.innerHTML = header + photosHtml;
    albumsList.appendChild(albumCard);
  });

  // Listeners para eliminar álbum
  document.querySelectorAll(".delete-album").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (confirm("¿Seguro que quieres eliminar este álbum y todas sus fotos?")) {
        await deleteAlbum(btn.dataset.id);
      }
    });
  });

  // Listeners para eliminar foto
  document.querySelectorAll(".delete-photo").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (confirm("¿Seguro que quieres eliminar esta foto?")) {
        await deletePhoto(btn.dataset.id);
      }
    });
  });

  // Listeners para ver todas las fotos
  document.querySelectorAll(".view-all-photos").forEach(btn => {
    btn.addEventListener("click", () => {
      const albumId = btn.dataset.albumId;
      const albumName = btn.dataset.albumName;
      const albumData = allAlbumsData.find(a => a.id === albumId);
      if (albumData) {
        openPhotosModal(albumData);
      }
    });
  });
};

// Función para abrir modal con todas las fotos
const openPhotosModal = (album) => {
  // Crear modal si no existe
  let modal = document.getElementById('allPhotosModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'allPhotosModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
      <div class="bg-white rounded-lg w-full max-w-6xl max-h-[90vh] overflow-auto relative">
        <div class="sticky top-0 bg-white border-b p-4 flex justify-between items-center z-10">
          <h3 class="text-xl font-bold" id="modalAlbumTitle"></h3>
          <button id="closePhotosModal" class="text-gray-500 hover:text-gray-700 text-3xl leading-none w-10 h-10 flex items-center justify-center">×</button>
        </div>
        <div class="p-6">
          <div id="modalPhotosGrid" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Listener para cerrar modal
    document.getElementById('closePhotosModal').addEventListener('click', () => {
      modal.classList.add('hidden');
    });
    
    // Cerrar al hacer clic fuera del contenido
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
      }
    });
  }

  // Actualizar contenido del modal
  document.getElementById('modalAlbumTitle').textContent = `${album.name} (${album.photos.length} fotos)`;
  const grid = document.getElementById('modalPhotosGrid');
  grid.innerHTML = album.photos.map(photo => `
    <div class="relative group">
      <img src="${photo.public_watermarked_url}" alt="Foto" class="w-full h-48 object-cover rounded">
      <button 
        class="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white w-9 h-9 rounded-full opacity-0 group-hover:opacity-100 delete-photo-modal flex items-center justify-center shadow-lg transition-opacity"
        data-id="${photo.id}" title="Eliminar foto"
      >
        <i class="fas fa-trash-alt"></i>
      </button>
    </div>
  `).join('');

  // Agregar listeners a los botones de eliminar del modal
  grid.querySelectorAll('.delete-photo-modal').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm('¿Seguro que quieres eliminar esta foto?')) {
        await deletePhoto(btn.dataset.id);
        modal.classList.add('hidden');
      }
    });
  });

  // Mostrar modal
  modal.classList.remove('hidden');
};

// Función para filtrar álbumes
const filterAlbums = () => {
  const searchText = searchAlbumText.value.toLowerCase().trim();
  const filterDate = filterAlbumDate.value;

  let filtered = allAlbumsData;

  // Filtrar por texto (nombre, descripción)
  if (searchText) {
    filtered = filtered.filter(album => {
      const name = album.name?.toLowerCase() || '';
      const description = album.description?.toLowerCase() || '';
      return name.includes(searchText) || description.includes(searchText);
    });
  }

  // Filtrar por fecha
  if (filterDate) {
    filtered = filtered.filter(album => album.event_date === filterDate);
  }

  renderAlbums(filtered);
};

const deleteAlbum = async (albumId) => {
  try {
    const res = await authenticatedFetch(`${BACKEND_URL}/albums/${albumId}`, { method: "DELETE" });
    if (res.ok) {
      fetchAlbumsWithPhotos();
      fetchAlbums(); // refresca dropdown
    }
  } catch (err) {
    console.error(err);
  }
};

// ==== EDITAR ÁLBUM ====
const editAlbumModal = document.getElementById("editAlbumModal");
const editAlbumName = document.getElementById("editAlbumName");
const editAlbumDate = document.getElementById("editAlbumDate");
const editAlbumDescription = document.getElementById("editAlbumDescription");
const editAlbumPrice = document.getElementById("editAlbumPrice");
const saveEditAlbum = document.getElementById("saveEditAlbum");
const cancelEditAlbum = document.getElementById("cancelEditAlbum");

document.addEventListener("click", (e) => {
  if (e.target.classList.contains("edit-album")) {
    editAlbumName.value = e.target.dataset.name;
    editAlbumDate.value = e.target.dataset.date;
    editAlbumDescription.value = e.target.dataset.description;
    editAlbumPrice.value = e.target.dataset.price || 15.0;
    saveEditAlbum.dataset.id = e.target.dataset.id;
    editAlbumModal.classList.remove("hidden");
  }
});

cancelEditAlbum.addEventListener("click", () => {
  editAlbumModal.classList.add("hidden");
});

saveEditAlbum.addEventListener("click", async () => {
  const id = saveEditAlbum.dataset.id;
  const name = editAlbumName.value.trim();
  const date = editAlbumDate.value;
  const description = editAlbumDescription.value.trim();
  const price = editAlbumPrice.value;

  if (!name) {
    alert("El nombre no puede estar vacío");
    return;
  }

  const res = await authenticatedFetch(`${BACKEND_URL}/albums/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      name, 
      event_date: date, 
      description,
      price_per_photo: Number(price)
    })
  });

  if (res.ok) {
    editAlbumModal.classList.add("hidden");
    fetchAlbumsWithPhotos();
    fetchAlbums(); // refresca el select
  } else {
    alert("Error al actualizar el álbum");
  }
});


const deletePhoto = async (photoId) => {
  try {
    const res = await authenticatedFetch(`${BACKEND_URL}/photos/${photoId}`, { method: "DELETE" });
    if (res.ok) {
      fetchAlbumsWithPhotos();
    }
  } catch (err) {
    console.error(err);
  }
};


  fetchAlbumsWithPhotos();

  document.getElementById("reloadAlbums").addEventListener("click", () => {
    fetchAlbumsWithPhotos();
    fetchAlbums(); // refresca también el dropdown
  });

  // Listeners para filtros
  searchAlbumText.addEventListener('input', filterAlbums);
  filterAlbumDate.addEventListener('change', filterAlbums);

}
