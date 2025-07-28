// public/gallery.js
document.addEventListener('DOMContentLoaded', () => {
    const albumIdInput = document.getElementById('albumId');
    const searchButton = document.getElementById('searchButton');
    const galleryContainer = document.getElementById('galleryContainer');
    const messageDiv = document.getElementById('message');
    const loadingDiv = document.getElementById('loading');
    const checkoutButton = document.getElementById('checkoutButton'); // Obtenemos la referencia al botón de checkout

    const showMessage = (msg, type) => {
        messageDiv.textContent = msg;
        messageDiv.className = '';
        if (type) {
            messageDiv.classList.add(type);
        }
    };

    const setLoading = (isLoading) => {
        loadingDiv.style.display = isLoading ? 'block' : 'none';
        searchButton.disabled = isLoading;
        albumIdInput.disabled = isLoading;
        checkoutButton.disabled = isLoading; // Deshabilita también el botón de checkout
    };

    // Función para actualizar la visualización del carrito
    const updateCartUI = () => {
        const cart = JSON.parse(localStorage.getItem('cart')) || [];
        const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
        const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        
        if (cartCount > 0) {
            showMessage(`Fotos en carrito: ${cartCount}. Total: $${cartTotal.toFixed(2)}.`, 'success');
        } else {
            showMessage('El carrito está vacío.', 'info');
        }
        console.log('Estado actual del carrito:', cart);
    };

    // Lógica principal de búsqueda de fotos
    searchButton.addEventListener('click', async () => {
        const albumId = albumIdInput.value.trim();

        if (!albumId) {
            showMessage('Por favor, ingresa un ID de álbum.', 'error');
            return;
        }
        if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(albumId)) {
            showMessage('El ID del álbum no tiene un formato UUID válido.', 'error');
            return;
        }

        setLoading(true);
        showMessage('', '');
        galleryContainer.innerHTML = ''; // Limpia fotos anteriores
        localStorage.removeItem('currentAlbumPhotos'); // Limpia fotos de álbum previas

        try {
            const response = await fetch(`http://localhost:3000/albums/${albumId}/photos`);
            const data = await response.json();

            if (response.ok) {
                if (data.photos && data.photos.length > 0) {
                    // Guarda las fotos obtenidas en localStorage PRIMERO
                    localStorage.setItem('currentAlbumPhotos', JSON.stringify(data.photos)); 

                    data.photos.forEach(photo => {
                        const photoItem = document.createElement('div');
                        photoItem.className = 'photo-item';
                        photoItem.innerHTML = `
                            <img src="${photo.public_watermarked_url}" alt="Foto de evento">
                            <div class="photo-info">
                                <p>Código: ${photo.student_code || 'N/A'}</p>
                                <p class="price">Precio: $${photo.price.toFixed(2)}</p>
                                <button data-photo-id="${photo.id}" class="add-to-cart-btn">Agregar al Carrito</button>
                            </div>
                        `;
                        galleryContainer.appendChild(photoItem);
                    });
                    showMessage(`Se encontraron ${data.photos.length} fotos.`, 'success');
                } else {
                    showMessage('No se encontraron fotos para este álbum.', 'error');
                }
            } else {
                showMessage(`Error al cargar fotos: ${data.message || 'Error desconocido'}`, 'error');
                console.error('Detalles del error:', data);
            }
        } catch (error) {
            console.error('Error de red o del servidor:', error);
            showMessage(`Error de conexión: ${error.message}. Asegúrate de que el backend esté funcionando.`, 'error');
        } finally {
            setLoading(false);
            updateCartUI(); // Actualiza el UI del carrito después de la búsqueda
        }
    });

    // Lógica para el botón "Agregar al Carrito"
    galleryContainer.addEventListener('click', (event) => {
        if (event.target.classList.contains('add-to-cart-btn')) {
            const photoId = event.target.dataset.photoId;
            const currentPhotosInGallery = JSON.parse(localStorage.getItem('currentAlbumPhotos')) || []; // Asegúrate de leerlo
            const photoToAdd = currentPhotosInGallery.find(p => p.id === photoId);

            if (photoToAdd) {
                let cart = JSON.parse(localStorage.getItem('cart')) || [];
                const existingItem = cart.find(item => item.photoId === photoId);

                if (existingItem) {
                    existingItem.quantity += 1;
                    showMessage('Cantidad actualizada en el carrito.', 'success');
                } else {
                    cart.push({
                        photoId: photoToAdd.id,
                        albumId: photoToAdd.album_id,
                        watermarkedUrl: photoToAdd.public_watermarked_url,
                        price: photoToAdd.price,
                        studentCode: photoToAdd.student_code,
                        quantity: 1
                    });
                    showMessage('Foto agregada al carrito.', 'success');
                }
                localStorage.setItem('cart', JSON.stringify(cart));
                updateCartUI(); 
            } else {
                showMessage('Error: Información de la foto no encontrada para agregar al carrito. Intenta buscar el álbum de nuevo.', 'error');
            }
        }
    });

        // Event listener para el botón de Checkout
        checkoutButton.addEventListener('click', async () => { // <--- ¡AÑADE 'async' AQUÍ!
            const cart = JSON.parse(localStorage.getItem('cart')) || [];
            if (cart.length === 0) {
                showMessage('Tu carrito está vacío. Agrega algunas fotos antes de finalizar la compra.', 'error');
                return;
            }

            // Solicitar el email del cliente (o algún identificador) - Esto es CRUCIAL para Mercado Pago y tu BD
            const customerEmail = prompt("Por favor, ingresa tu email para la confirmación de compra:");
            if (!customerEmail || !customerEmail.includes('@')) {
                showMessage('Necesitamos un email válido para procesar tu compra.', 'error');
                return;
            }
            
            setLoading(true); // Muestra spinner de carga
            showMessage('Procesando tu pedido...', 'info');

            try {
                const response = await fetch('http://localhost:3000/create-payment-preference', { // <--- ¡LLAMADA AL BACKEND!
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ cart: cart, customerEmail: customerEmail })
                });

                const data = await response.json();

                if (response.ok) {
                    showMessage('Pedido creado. Redirigiendo a Mercado Pago...', 'success');
                    localStorage.removeItem('cart'); // Limpia el carrito local
                    localStorage.removeItem('currentAlbumPhotos'); // Limpia las fotos del álbum actual

                    // Redirige al cliente a la URL de pago de Mercado Pago
                    window.location.href = data.init_point; // <-- ¡REDIRECCIÓN A MERCADO PAGO!
                } else {
                    showMessage(`Error al crear pedido: ${data.message || 'Error desconocido'}`, 'error');
                    console.error('Detalles del error:', data);
                }
            } catch (error) {
                console.error('Error de red o del servidor al crear preferencia:', error);
                showMessage(`Error de conexión: ${error.message}. Asegúrate de que el backend esté funcionando.`, 'error');
            } finally {
                setLoading(false);
                updateCartUI(); // Actualiza el UI del carrito (debería mostrarse vacío)
            }
        });

    // Al cargar la página, inicializa el estado del carrito
    updateCartUI();
});