// --- Constante para la URL del Backend ---
// --- DOM Elements ---
const albumSelector = document.getElementById("albumSelector");
const searchButton = document.getElementById("searchButton");
const messageDiv = document.getElementById("message");
const loadingDiv = document.getElementById("loading");
const recentAlbumsContainer = document.getElementById("recentAlbumsContainer");
const recentAlbumsTitle = document.getElementById("recentAlbumsTitle");
const galleryContainer = document.getElementById("galleryContainer");
const galleryTitle = document.getElementById("galleryTitle");
const noPhotosMessage = document.getElementById("noPhotosMessage");
// const checkoutButton = document.getElementById('checkoutButton'); // ELIMINADO
const cartCountSpan = document.getElementById("cart-count");
// const cartTotalCheckoutSpan = document.getElementById('cart-total-checkout'); // ELIMINADO
const contentAfterSearch = document.getElementById("contentAfterSearch"); // New container for dynamic content
const noRecentAlbumsMessage = document.getElementById("noRecentAlbumsMessage"); // New element for no recent albums

// Modal elements
const photoDetailModal = document.getElementById("photo-detail-modal");
const modalPhotoImg = document.getElementById("modal-photo-img");
const modalPhotoTitle = document.getElementById("modal-photo-title");
const modalPhotoEvent = document.getElementById("modal-photo-event");
const modalPhotoSchool = document.getElementById("modal-photo-school");
const modalPhotoPrice = document.getElementById("modal-photo-price");
const modalAddToCartBtn = document.getElementById("modal-add-to-cart-btn");
const modalBuyNowBtn = document.getElementById("modal-buy-now-btn");

// Cart Modal Elements
const cartLink = document.getElementById("cartLink");
const cartModal = document.getElementById("cart-modal");
const cartModalItemsContainer = document.getElementById("cart-modal-items-container");
const cartModalEmptyMessage = document.getElementById("cart-modal-empty-message");
const cartModalSubtotalSpan = document.getElementById("cart-modal-subtotal");
const cartModalTotalSpan = document.getElementById("cart-modal-total");
const cartModalCheckoutBtn = document.getElementById("cart-modal-checkout-btn");

let currentAlbumPhotos = []; // Stores photos for the current album in gallery

// --- Utility Functions ---
const showMessage = (msg, type) => {
    messageDiv.textContent = msg;
    messageDiv.className = "message";
    messageDiv.classList.add(type);
    messageDiv.classList.remove("hidden");
};

const hideMessage = () => {
    messageDiv.classList.add("hidden");
    messageDiv.textContent = "";
};

const setLoading = (isLoading) => {
    loadingDiv.classList.toggle("hidden", !isLoading);
    searchButton.disabled = isLoading;
    albumSelector.disabled = isLoading;
    // checkoutButton.disabled = isLoading; // ELIMINADO
    cartModalCheckoutBtn.disabled = isLoading; // Disable cart modal checkout button
    if (!photoDetailModal.classList.contains("hidden")) {
        modalAddToCartBtn.disabled = isLoading;
        modalBuyNowBtn.disabled = isLoading;
    }
};

// --- Cart Logic ---
const getCart = () => JSON.parse(localStorage.getItem("cart")) || [];
const saveCart = (cart) => localStorage.setItem("cart", JSON.stringify(cart));

const updateCartUI = () => {
    const cart = getCart();
    const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
    const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    if (cartCountSpan) cartCountSpan.textContent = cartCount;
    // cartTotalCheckoutSpan.textContent = cartTotal.toFixed(2); // ELIMINADO

    // Update cart modal totals (if modal is open or for consistency)
    if (cartModalSubtotalSpan) cartModalSubtotalSpan.textContent = cartTotal.toFixed(2);
    if (cartModalTotalSpan) cartModalTotalSpan.textContent = cartTotal.toFixed(2);
    if (cartModalCheckoutBtn) cartModalCheckoutBtn.disabled = cartCount === 0;
};

const addToCart = (photoToAdd) => {
    let cart = getCart();
    const existingItem = cart.find((item) => item.photoId === photoToAdd.id);

    if (existingItem) {
        existingItem.quantity += 1;
        showMessage("Cantidad actualizada en el carrito.", "success");
    } else {
        cart.push({
            photoId: photoToAdd.id,
            albumId: photoToAdd.album_id,
            watermarkedUrl: photoToAdd.public_watermarked_url,
            price: photoToAdd.price,
            studentCode: photoToAdd.student_code,
            quantity: 1,
        });
        showMessage("Foto agregada al carrito.", "success");
    }
    saveCart(cart);
    updateCartUI();
};

const removeFromCart = (photoId) => {
    let cart = getCart();
    cart = cart.filter((item) => item.photoId !== photoId);
    saveCart(cart);
    showMessage("Foto eliminada del carrito.", "info");
    renderCartModal(); // Re-render the cart modal after removal
};

const renderCartModal = () => {
    const cart = getCart();
    cartModalItemsContainer.innerHTML = ""; // Clear existing items

    if (cart.length === 0) {
        cartModalEmptyMessage.classList.remove("hidden");
        cartModalItemsContainer.appendChild(cartModalEmptyMessage);
    } else {
        cartModalEmptyMessage.classList.add("hidden");
        cart.forEach((item) => {
            const cartItemDiv = document.createElement("div");
            cartItemDiv.className = "cart-item-modal"; // Use specific class for modal cart items
            cartItemDiv.innerHTML = `
                <div class="flex items-center">
                    <img src="${item.watermarkedUrl}" alt="Miniatura Foto" class="relative">
                    <div class="cart-item-modal-info">
                        <h4>Código: ${item.studentCode || "N/A"}</h4>
                        <p>Precio: $${item.price.toFixed(2)} ARS</p>
                        <p>Cantidad: ${item.quantity}</p>
                    </div>
                </div>
                <div class="cart-item-modal-actions">
                    <button class="text-red-500 hover:text-red-700 font-medium" data-photo-id="${item.photoId}">Eliminar</button>
                </div>
            `;
            cartModalItemsContainer.appendChild(cartItemDiv);
        });
    }
    updateCartUI(); // Update totals and button state
};

const showCartModal = () => {
    renderCartModal(); // Render cart content before showing
    cartModal.classList.remove("hidden");
};

const hideCartModal = () => {
    cartModal.classList.add("hidden");
};

// --- Gallery and Photo Detail Logic ---
const fetchAlbumsForSelector = async () => {
    albumSelector.innerHTML = '<option value="">Cargando álbumes...</option>';
    albumSelector.disabled = true;
    try {
        const response = await fetch(`${BACKEND_URL}/albums`);
        const data = await response.json();

        if (response.ok) {
            albumSelector.innerHTML = '<option value="">-- Elegí un colegio / álbum --</option>';
            if (data.albums && data.albums.length > 0) {
                data.albums.forEach((album) => {
                    const option = document.createElement("option");
                    option.value = album.id;
                    option.textContent = album.name;
                    albumSelector.appendChild(option);
                });
                renderRecentAlbums(data.albums); // Render recent albums after fetching
            } else {
                albumSelector.innerHTML += '<option value="">No hay álbumes disponibles</option>';
                noRecentAlbumsMessage.classList.remove("hidden"); // Show message if no albums
            }
        } else {
            showMessage(`Error al cargar álbumes: ${data.message || "Error desconocido"}`, "error");
        }
    } catch (error) {
        console.error("Error de red al cargar álbumes para selector:", error);
        showMessage(`Error de conexión al cargar álbumes: ${error.message}`, "error");
    } finally {
        albumSelector.disabled = false;
    }
};

const renderRecentAlbums = (albums) => {
    recentAlbumsContainer.innerHTML = ""; // Clear previous content
    noRecentAlbumsMessage.classList.add("hidden"); // Hide no albums message by default

    if (!albums || albums.length === 0) {
        noRecentAlbumsMessage.classList.remove("hidden");
        return;
    }

    // Take a subset of albums for "recent" or "featured"
    const albumsToShow = albums.slice(0, 3); // Show first 3 as example

    albumsToShow.forEach((album) => {
        const albumCard = document.createElement("div");
        albumCard.className = "bg-white rounded-xl shadow-lg p-4 text-center border border-gray-200";
        albumCard.innerHTML = `
            <h3 class="text-lg font-semibold mb-2">${album.name}</h3>
            <button class="btn-secondary text-sm" data-album-id="${album.id}">Ver Galería</button>
        `;
        recentAlbumsContainer.appendChild(albumCard);
    });
};

const renderPhotos = (photos, albumName = "Álbum Seleccionado") => {
    galleryContainer.innerHTML = "";
    noPhotosMessage.classList.add("hidden"); // Hide no photos message by default
    galleryTitle.textContent = `Fotos del Álbum: ${albumName}`;

    if (photos.length === 0) {
        noPhotosMessage.classList.remove("hidden");
        return;
    }

    photos.forEach((photo) => {
        const photoItem = document.createElement("div");
        photoItem.className = "photo-item relative group";
        photoItem.innerHTML = `
            <img src="${photo.public_watermarked_url}" alt="Foto de evento" class="w-full h-48 object-cover rounded-md transition-transform duration-300 group-hover:scale-105">
            <div class="watermark-overlay rounded-md"></div>
            <div class="absolute inset-0 bg-black bg-opacity-40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-md">
                <button class="btn-primary text-sm px-4 py-2" data-photo-id="${photo.id}">Ver / Comprar</button>
            </div>
            <div class="p-2 text-left">
                <p class="text-sm font-semibold">Código: ${photo.student_code || "N/A"}</p>
                <p class="text-xs text-gray-600">Precio: $${photo.price.toFixed(2)} ARS</p>
            </div>
        `;
        photoItem.querySelector("button").addEventListener("click", () => {
            showPhotoDetailModal(photo);
        });
        galleryContainer.appendChild(photoItem);
    });
    showMessage(`Se encontraron ${photos.length} fotos.`, "success");
};

const showPhotoDetailModal = (photo) => {
    modalPhotoImg.src = photo.public_watermarked_url;
    modalPhotoTitle.textContent = `Foto Código: ${photo.student_code || "N/A"}`;
    // These would ideally come from the backend with album details
    modalPhotoEvent.textContent = `Evento del Álbum`;
    modalPhotoSchool.textContent = `Nombre del Colegio`;
    modalPhotoPrice.textContent = `Precio: $${photo.price.toFixed(2)} ARS`;

    modalAddToCartBtn.onclick = () => {
        addToCart(photo);
        hidePhotoDetailModal();
    };

    // Botón "Comprar Ahora"
    modalBuyNowBtn.onclick = () => {
        // Mostrar campo de email dentro del modal
        document.getElementById("email-buy-now").classList.remove("hidden");
    };

    // Botón "Confirmar Compra"
    document.getElementById("confirmBuyNowBtn").onclick = async () => {
        const customerEmail = document.getElementById("buyNowEmail").value.trim();

        if (!isValidEmail(customerEmail)) {
            showMessage("Necesitamos un email válido para procesar tu compra.", "error");
            return;
        }

        const singleItemCart = [
            {
                photoId: photo.id,
                albumId: photo.album_id,
                watermarkedUrl: photo.public_watermarked_url,
                price: photo.price,
                studentCode: photo.student_code,
                quantity: 1,
            },
        ];
        

        setLoading(true);
        showMessage("Procesando tu compra directa...", "info");

        try {
            const response = await fetch(`${BACKEND_URL}/create-payment-preference`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    cart: singleItemCart,
                    customerEmail: customerEmail,
                }),
            });

            const data = await response.json();

            if (response.ok) {
                showMessage("Pedido creado. Redirigiendo a Mercado Pago...", "success");
                saveCart([]);
                updateCartUI();
                window.location.href = data.init_point;
            } else {
                showMessage(`Error al procesar compra directa: ${data.message || "Error desconocido"}`, "error");
                console.error("Detalles del error:", data);
            }
        } catch (error) {
            console.error("Error de red o del servidor al crear preferencia (compra directa):", error);
            showMessage(`Error de conexión: ${error.message}. Asegúrate de que el backend esté funcionando.`, "error");
        } finally {
            setLoading(false);
        }
    };

    photoDetailModal.classList.remove("hidden");
};

const hidePhotoDetailModal = () => {
    photoDetailModal.classList.add("hidden");
};

// --- Event Handlers ---
albumSelector.addEventListener("change", () => {
    if (albumSelector.value) {
        searchButton.click(); // Trigger search if an album is selected from dropdown
    }
});

searchButton.addEventListener("click", async () => {
    const albumId = albumSelector.value.trim(); // Get albumId directly from selector
    if (!albumId) {
        showMessage("Por favor, selecciona un álbum.", "error"); // Updated message
        return;
    }

    setLoading(true);
    hideMessage();
    galleryContainer.innerHTML = "";
    currentAlbumPhotos = [];
    contentAfterSearch.classList.add("hidden"); // Hide content while loading

    try {
        const response = await fetch(`${BACKEND_URL}/albums/${albumId}/photos`);
        const data = await response.json();

        if (response.ok) {
            currentAlbumPhotos = data.photos;
            const selectedAlbumOption = Array.from(albumSelector.options).find((opt) => opt.value === albumId);
            const albumName = selectedAlbumOption ? selectedAlbumOption.textContent : `Álbum ${albumId.substring(0, 8)}...`;
            renderPhotos(data.photos, albumName);
            contentAfterSearch.classList.remove("hidden"); // Show content after successful search
        } else {
            showMessage(`Error al cargar fotos: ${data.message || "Error desconocido"}`, "error");
            console.error("Detalles del error:", data);
        }
    } catch (error) {
        console.error("Error de red o del servidor:", error);
        showMessage(`Error de conexión: ${error.message}. Asegúrate de que el backend esté funcionando.`, "error");
    } finally {
        setLoading(false);
    }
});

// Event listener for "Ver Galería" buttons in Recent Albums
recentAlbumsContainer.addEventListener("click", (event) => {
    if (event.target.tagName === "BUTTON" && event.target.dataset.albumId) {
        albumSelector.value = event.target.dataset.albumId; // Set dropdown value
        searchButton.click(); // Trigger search
    }
});

// Event listener for cartLink to open the cart modal (solo si existe el elemento)
if (cartLink) {
    cartLink.addEventListener("click", (e) => {
        e.preventDefault();
        showCartModal();
    });
}

// Event listener for remove buttons in the cart modal (delegation)
if (cartModalItemsContainer) {
    cartModalItemsContainer.addEventListener("click", (event) => {
        if (event.target.tagName === "BUTTON" && event.target.dataset.photoId) {
            const photoId = event.target.dataset.photoId;
            removeFromCart(photoId);
        }
    });
}

// Event listener for checkout button inside cart modal
// Event listener para el botón de pagar dentro del carrito
if (cartModalCheckoutBtn) {
    cartModalCheckoutBtn.addEventListener("click", () => {
        const cart = getCart();
        if (cart.length === 0) {
            showMessage("Tu carrito está vacío. Agrega algunas fotos antes de finalizar la compra.", "error");
            return;
        }
        hideCartModal();
        showCartEmailModal();
    });
}

// Event listener para confirmar compra desde el modal de email
const cartEmailConfirmBtn = document.getElementById("cartEmailConfirmBtn");
if (cartEmailConfirmBtn) {
    cartEmailConfirmBtn.addEventListener("click", async () => {
        const cart = getCart();
        const customerEmail = document.getElementById("cartEmailInput").value.trim();
        const emailError = document.getElementById("cartEmailError");

        if (!isValidEmail(customerEmail)) {
            if (emailError) emailError.classList.remove("hidden");
            return;
        } else {
            if (emailError) emailError.classList.add("hidden");
        }

        setLoading(true);
        showMessage("Procesando tu pedido...", "info");

        try {
            const response = await fetch(`${BACKEND_URL}/create-payment-preference`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cart: cart, customerEmail: customerEmail }),
            });

            const data = await response.json();

            if (response.ok) {
                hideCartEmailModal();
                showMessage("Pedido creado. Redirigiendo a Mercado Pago...", "success");
                saveCart([]);
                updateCartUI();
                window.location.href = data.init_point;
            } else {
                showMessage(`Error al crear pedido: ${data.message || "Error desconocido"}`, "error");
                console.error("Detalles del error:", data);
            }
        } catch (error) {
            console.error("Error de red o del servidor al crear preferencia:", error);
            showMessage(`Error de conexión: ${error.message}. Asegúrate de que el backend esté funcionando.`, "error");
        } finally {
            setLoading(false);
        }
    });
}

// --- Initial Load ---
document.addEventListener("DOMContentLoaded", () => {
    fetchAlbumsForSelector(); // Load albums for the dropdown
    updateCartUI(); // Update cart count on load
});

const isValidEmail = (email) => {
    // Valida formato típico de email
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
};

function showBuyNowModal() {
    document.getElementById("buy-now-modal").classList.remove("hidden");
}

function hideBuyNowModal() {
    document.getElementById("buy-now-modal").classList.add("hidden");
}

document.getElementById("confirmBuyNowBtn").addEventListener("click", () => {
    const emailInput = document.getElementById("buyNowEmail");
    const errorMsg = document.getElementById("buyNowError");

    if (!emailInput.value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.value)) {
        errorMsg.classList.remove("hidden");
    } else {
        errorMsg.classList.add("hidden");
        // Aquí ejecutás la lógica de compra
        console.log("Email válido:", emailInput.value);
        hideBuyNowModal();
    }
});



function showCartEmailModal() {
    document.getElementById("cart-email-modal").classList.remove("hidden");
}

function hideCartEmailModal() {
    document.getElementById("cart-email-modal").classList.add("hidden");
}


