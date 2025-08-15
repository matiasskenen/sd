export function init() {
  console.log("Sección de álbumes cargada");

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
  const previewContainer = document.getElementById('previewContainer');
  const uploadButton = document.getElementById('uploadButton');
  const loadingSpinner = document.getElementById('loading-spinner');
  const loadingDiv = document.getElementById('loading');
  const messageDiv = document.getElementById('message');
  const clearAlbumSelectionButton = document.getElementById('clearAlbumSelection');
  const newAlbumDateInput = document.getElementById('newAlbumDateInput');
  const newAlbumDescriptionInput = document.getElementById('newAlbumDescriptionInput');

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
      const response = await fetch(`${BACKEND_URL}/albums`);
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

  if (!newAlbumName) {
    showMessage('Por favor, ingresa un nombre para el nuevo álbum.', 'error');
    return null;
  }

  setLoading(true);
  hideMessage();

  try {
    const response = await fetch(`${BACKEND_URL}/albums`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newAlbumName,
        event_date: newAlbumDate,
        description: newAlbumDescription
      })
    });

    const data = await response.json();
    if (response.ok) {
      showMessage(`Álbum "${data.album.name}" creado exitosamente!`, 'success');
      newAlbumNameInput.value = '';
      newAlbumDateInput.value = '';
      newAlbumDescriptionInput.value = '';
      await fetchAlbums();
      albumSelect.value = data.album.id;
      setAlbumSelectionState();
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
    const newAlbumNameEntered = newAlbumNameInput.value.trim().length > 0;
    if (selectedAlbumId) {
      newAlbumNameInput.disabled = true;
      confirmCreateAlbumButton.disabled = true;
      cancelCreateAlbumButton.disabled = true;
      newAlbumNameInput.value = '';
      clearAlbumSelectionButton.classList.remove('hidden');
      albumCreationMode.classList.add('hidden');
      albumSelectionMode.classList.remove('hidden');
    } else if (newAlbumNameEntered) {
      albumSelect.disabled = true;
      toggleCreateNewAlbumModeButton.disabled = true;
      clearAlbumSelectionButton.classList.add('hidden');
    } else {
      albumSelect.disabled = false;
      newAlbumNameInput.disabled = false;
      toggleCreateNewAlbumModeButton.disabled = false;
      clearAlbumSelectionButton.classList.add('hidden');
      albumCreationMode.classList.add('hidden');
      albumSelectionMode.classList.remove('hidden');
    }
  };

  albumSelect.addEventListener('change', setAlbumSelectionState);
  newAlbumNameInput.addEventListener('input', setAlbumSelectionState);
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
    newAlbumNameInput.focus();
  });
  cancelCreateAlbumButton.addEventListener('click', () => {
    newAlbumNameInput.value = '';
    albumCreationMode.classList.add('hidden');
    albumSelectionMode.classList.remove('hidden');
    albumSelect.disabled = false;
    setAlbumSelectionState();
  });
  confirmCreateAlbumButton.addEventListener('click', createAlbum);

    photosInput.addEventListener('change', async (event) => {
      previewContainer.innerHTML = '';
      const watermarkUrl = '/assets/watermark.png'; // ruta pública accesible desde el frontend

      // Cargar marca de agua como imagen
      const watermarkImg = new Image();
      watermarkImg.src = watermarkUrl;
      await new Promise(res => watermarkImg.onload = res);

      Array.from(event.target.files).forEach(file => {
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = async (e) => {
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

            // Calcular tamaño proporcional para la marca de agua
            const wmWidth = img.width * 0.25; // 25% del ancho
            const wmHeight = watermarkImg.height * (wmWidth / watermarkImg.width);

            // Posicionar marca de agua en el centro (igual que en Sharp)
            const wmX = (img.width - wmWidth) / 2;
            const wmY = (img.height - wmHeight) / 2;

            ctx.globalAlpha = 0.5; // transparencia
            ctx.drawImage(watermarkImg, wmX, wmY, wmWidth, wmHeight);

            // Crear preview
            const previewItem = document.createElement('div');
            previewItem.className = 'preview-item';
            previewItem.innerHTML = `<img src="${canvas.toDataURL('image/jpeg', 0.8)}" alt="Preview">`;
            previewContainer.appendChild(previewItem);
          };
          reader.readAsDataURL(file);
        }
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
      const response = await fetch(`${BACKEND_URL}/upload-photos/${albumIdToUse}`, {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      if (response.ok) {
        showMessage(`¡${data.summary}!`, 'success');
        uploadForm.reset();
        previewContainer.innerHTML = '';
        fetchAlbums();
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


  const albumsList = document.getElementById('albumsList');

const fetchAlbumsWithPhotos = async () => {
  albumsList.innerHTML = `<p class="text-gray-500">Cargando álbumes...</p>`;
  try {
    const res = await fetch(`${BACKEND_URL}/albums-with-photos`);
    const data = await res.json();

    if (res.ok && Array.isArray(data)) {
      if (data.length === 0) {
        albumsList.innerHTML = `<p class="text-gray-500">No hay álbumes creados.</p>`;
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
            </div>
            <div class="flex gap-2">
              <button class="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded edit-album" 
                data-id="${album.id}" 
                data-name="${album.name}" 
                data-date="${album.event_date}" 
                data-description="${album.description || ''}">
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
          photosHtml = `
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
              ${album.photos.map(photo => `
                <div class="relative group">
                  <img src="${photo.public_watermarked_url}" alt="Foto" class="w-full h-32 object-cover rounded">
                  <button 
                    class="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white p-1 rounded opacity-0 group-hover:opacity-100 delete-photo"
                    data-id="${photo.id}"
                  >
                    <i class="fas fa-trash-alt"></i>
                  </button>
                </div>
              `).join("")}
            </div>
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

    } else {
      albumsList.innerHTML = `<p class="text-red-500">Error al cargar álbumes.</p>`;
    }
  } catch (err) {
    console.error(err);
    albumsList.innerHTML = `<p class="text-red-500">Error de conexión.</p>`;
  }
};

const deleteAlbum = async (albumId) => {
  try {
    const res = await fetch(`${BACKEND_URL}/albums/${albumId}`, { method: "DELETE" });
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
const saveEditAlbum = document.getElementById("saveEditAlbum");
const cancelEditAlbum = document.getElementById("cancelEditAlbum");

document.addEventListener("click", (e) => {
  if (e.target.classList.contains("edit-album")) {
    editAlbumName.value = e.target.dataset.name;
    editAlbumDate.value = e.target.dataset.date;
    editAlbumDescription.value = e.target.dataset.description;
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

  if (!name) {
    alert("El nombre no puede estar vacío");
    return;
  }

  const res = await fetch(`${BACKEND_URL}/albums/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, event_date: date, description })
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
    const res = await fetch(`${BACKEND_URL}/photos/${photoId}`, { method: "DELETE" });
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

}
