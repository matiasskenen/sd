document.addEventListener('DOMContentLoaded', () => {
    const albumIdInput = document.getElementById('albumId');
    const searchButton = document.getElementById('searchButton');
    const galleryContainer = document.getElementById('galleryContainer');
    const messageDiv = document.getElementById('message');
    const loadingDiv = document.getElementById('loading');
    const albumSelector = document.getElementById('albumSelector');
    const recentContainer = document.getElementById('recentAlbumsContainer');

    const showMessage = (msg, type) => {
        messageDiv.textContent = msg;
        messageDiv.className = 'text-sm font-medium';
        if (type === 'success') messageDiv.classList.add('text-green-600');
        else if (type === 'error') messageDiv.classList.add('text-red-600');
        else if (type === 'info') messageDiv.classList.add('text-blue-600');
    };

    const setLoading = (isLoading) => {
        loadingDiv.style.display = isLoading ? 'block' : 'none';
        searchButton.disabled = isLoading;
        albumIdInput.disabled = isLoading;
        albumSelector.disabled = isLoading;
    };

    const updateCartUI = () => {
        const cart = JSON.parse(localStorage.getItem('cart')) || [];
        const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
        const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

        if (cartCount > 0) {
            showMessage(`Fotos en carrito: ${cartCount}. Total: $${cartTotal.toFixed(2)}`, 'success');
        } else {
            showMessage('El carrito está vacío.', 'info');
        }
    };

    searchButton.addEventListener('click', async () => {
        const albumId = albumIdInput.value.trim();

        if (!albumId || !/^[0-9a-fA-F-]{36}$/.test(albumId)) {
            showMessage('ID de álbum inválido.', 'error');
            return;
        }

        setLoading(true);
        galleryContainer.innerHTML = '';
        localStorage.removeItem('currentAlbumPhotos');

        try {
            const res = await fetch(`${BACKEND_URL}/albums/${albumId}/photos`);
            const data = await res.json();

            if (res.ok && data.photos?.length > 0) {
                localStorage.setItem('currentAlbumPhotos', JSON.stringify(data.photos));
                data.photos.forEach(photo => {
                    const div = document.createElement('div');
                    div.className = 'photo-item bg-white p-4 rounded shadow';
                    div.innerHTML = `
                        <img src="${photo.public_watermarked_url}" alt="Foto" class="mb-2 rounded" />
                        <p><strong>Código:</strong> ${photo.student_code || 'N/A'}</p>
                        <p><strong>Precio:</strong> $${photo.price.toFixed(2)}</p>
                        <button data-photo-id="${photo.id}" class="add-to-cart-btn mt-2 bg-indigo-500 text-white px-2 py-1 rounded">Agregar al Carrito</button>
                    `;
                    galleryContainer.appendChild(div);
                });
                showMessage(`Se encontraron ${data.photos.length} fotos.`, 'success');
            } else {
                showMessage('No se encontraron fotos para este álbum.', 'error');
            }
        } catch (err) {
            showMessage('Error de conexión.', 'error');
            console.error(err);
        } finally {
            setLoading(false);
            updateCartUI();
        }
    });

    galleryContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('add-to-cart-btn')) {
            const photoId = e.target.dataset.photoId;
            const albumPhotos = JSON.parse(localStorage.getItem('currentAlbumPhotos')) || [];
            const photo = albumPhotos.find(p => p.id === photoId);
            if (!photo) return;

            let cart = JSON.parse(localStorage.getItem('cart')) || [];
            const exists = cart.find(i => i.photoId === photoId);
            if (exists) {
                exists.quantity++;
            } else {
                cart.push({
                    photoId: photo.id,
                    albumId: photo.album_id,
                    watermarkedUrl: photo.public_watermarked_url,
                    price: photo.price,
                    studentCode: photo.student_code,
                    quantity: 1
                });
            }
            localStorage.setItem('cart', JSON.stringify(cart));
            updateCartUI();
        }
    });

    // 🔄 Inicializar álbumes recientes y selector
    (async () => {
        try {
            const res = await fetch(`${BACKEND_URL}/albums`);
            const data = await res.json();

            if (res.ok && data.albums) {
                const albums = data.albums;
                const last3 = albums.slice(-3).reverse();

                // llenar <select>
                albums.forEach(a => {
                    const opt = document.createElement('option');
                    opt.value = a.id;
                    opt.textContent = a.name;
                    albumSelector.appendChild(opt);
                });

                // tarjetas últimas
                last3.forEach(a => {
                    const card = document.createElement('div');
                    card.className = 'bg-white rounded p-4 shadow text-center';
                    card.innerHTML = `
                        <div class="mb-2 text-lg font-semibold">${a.name}</div>
                        <button class="bg-indigo-600 text-white px-3 py-1 rounded" onclick="document.getElementById('albumId').value='${a.id}'; document.getElementById('searchButton').click();">Ver Galería</button>
                    `;
                    recentContainer.appendChild(card);
                });

                albumSelector.addEventListener('change', (e) => {
                    if (e.target.value) {
                        albumIdInput.value = e.target.value;
                        searchButton.click();
                    }
                });
            }
        } catch (err) {
            console.error('Error cargando álbumes:', err);
        }
    })();

    updateCartUI();
});
