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
        body: JSON.stringify({ name: newAlbumName, event_date: new Date().toISOString().split('T')[0] })
      });
      const data = await response.json();
      if (response.ok) {
        showMessage(`Álbum "${data.album.name}" creado exitosamente!`, 'success');
        newAlbumNameInput.value = '';
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

  photosInput.addEventListener('change', (event) => {
    previewContainer.innerHTML = '';
    Array.from(event.target.files).forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const previewItem = document.createElement('div');
          previewItem.className = 'preview-item';
          previewItem.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
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
}
