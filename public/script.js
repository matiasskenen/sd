// public/script.js

// Verificar si el usuario está autenticado al cargar la página
const accessToken = localStorage.getItem('supabaseAccessToken');

if (!accessToken) {
    // Si no hay token, redirigir a la página de login
    window.location.href = 'login.html';
}

document.addEventListener('DOMContentLoaded', () => {
    const albumIdInput = document.getElementById('albumId');
    const photosInput = document.getElementById('photos');
    const uploadButton = document.getElementById('uploadButton');
    const messageDiv = document.getElementById('message');
    const loadingDiv = document.getElementById('loading');
    const previewContainer = document.getElementById('previewContainer');

    // Función para mostrar mensajes
    const showMessage = (msg, type) => {
        messageDiv.textContent = msg;
        messageDiv.className = ''; // Limpia clases anteriores
        if (type) { // Solo añade la clase si 'type' no está vacío
            messageDiv.classList.add(type);
        } // Añade 'success' o 'error'
    };

    // Función para mostrar/ocultar spinner de carga
    const setLoading = (isLoading) => {
        loadingDiv.style.display = isLoading ? 'block' : 'none';
        uploadButton.disabled = isLoading;
        albumIdInput.disabled = isLoading;
        photosInput.disabled = isLoading;
    };

    // Previsualización de imágenes
    photosInput.addEventListener('change', (event) => {
        previewContainer.innerHTML = ''; // Limpia previsualizaciones anteriores
        const files = event.target.files;

        if (files.length > 0) {
            for (const file of files) {
                if (file.type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const img = document.createElement('img');
                        img.src = e.target.result;
                        const div = document.createElement('div');
                        div.className = 'preview-item';
                        div.appendChild(img);
                        previewContainer.appendChild(div);
                    };
                    reader.readAsDataURL(file);
                }
            }
        }
    });

    // Event Listener para el botón de subida
    uploadButton.addEventListener('click', async () => {
        const albumId = albumIdInput.value.trim();
        const files = photosInput.files;

        // Validaciones básicas
        if (!albumId) {
            showMessage('Por favor, ingresa un ID de álbum.', 'error');
            return;
        }
        if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(albumId)) {
            showMessage('El ID del álbum no tiene un formato UUID válido.', 'error');
            return;
        }
        if (files.length === 0) {
            showMessage('Por favor, selecciona al menos una foto para subir.', 'error');
            return;
        }

        setLoading(true); // Muestra el spinner de carga
        messageDiv.textContent = ''; // Solo limpia el texto
        messageDiv.className = '';   // Y limpia las clases de estilo

        const formData = new FormData();
        for (let i = 0; i < files.length; i++) {
            formData.append('photos', files[i]); // 'photos' debe coincidir con upload.array('photos') en el backend
        }

        try {
            const response = await fetch(`http://localhost:3000/upload-photos/${albumId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                },
                body: formData, // FormData automáticamente establece el Content-Type: multipart/form-data
            });

            const data = await response.json();

            if (response.ok) {
                let successCount = data.results.filter(r => r.status === 'success').length;
                let failedCount = data.results.filter(r => r.status === 'failed').length;
                let msg = `Subida completada: ${successCount} fotos exitosas, ${failedCount} fallidas.`;
                if (failedCount > 0) {
                    msg += '\nErrores: ' + data.results.filter(r => r.status === 'failed').map(r => `${r.originalName}: ${r.error}`).join('\n');
                }
                showMessage(msg, 'success');

                // Opcional: Mostrar URLs de las fotos con marca de agua (solo para depuración)
                const watermarkedUrls = data.results
                    .filter(r => r.status === 'success' && r.publicWatermarkedUrl)
                    .map(r => `<a href="${r.publicWatermarkedUrl}" target="_blank">${r.originalName}</a>`)
                    .join('<br>');
                if (watermarkedUrls) {
                    messageDiv.innerHTML += `<br><br>URLs de previsualización:<br>${watermarkedUrls}`;
                }

                // Limpiar formulario
                photosInput.value = '';
                previewContainer.innerHTML = '';
            } else {
                showMessage(`Error al subir: ${data.message || 'Error desconocido'}`, 'error');
                console.error('Detalles del error:', data);
            }
        } catch (error) {
            console.error('Error de red o del servidor:', error);
            showMessage(`Error de conexión: ${error.message}. Asegúrate de que el backend esté funcionando.`, 'error');
        } finally {
            setLoading(false); // Oculta el spinner de carga
        }
    });
});