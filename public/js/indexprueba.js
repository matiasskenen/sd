
// La URL del backend provista por el código original (sin uso real en este entorno)
const BACKEND_URL = "https://school-photos-backend.onrender.com";

/* ===== ELEMENTOS GLOBALES ===== */
const loadingGlobal = document.getElementById("loadingGlobal");
// noAlbumsMessage no existe en el HTML replicado, pero sí en el JS original
const contentAfterSearch = document.getElementById("contentAfterSearch");
const galleryContainer = document.getElementById("galleryContainer");
const galleryTitle = document.getElementById("galleryTitle");
const noPhotosMessage = document.getElementById("noPhotosMessage");

const cartCountSpan = document.getElementById("cart-count");
const cartModal = document.getElementById("cart-modal");
const cartModalItemsContainer = document.getElementById("cart-modal-items-container");
const cartModalTotalSpan = document.getElementById("cart-modal-total");

/* ===== LÓGICA DEL CARRITO (Implementación de funciones faltantes) ===== */
const getCart = () => JSON.parse(localStorage.getItem("cart")) || [];
const saveCart = (cart) => localStorage.setItem("cart", JSON.stringify(cart));

function updateCartUI() {
    const cart = getCart();
    cartCountSpan.textContent = cart.length;

    // Actualiza el modal del carrito
    cartModalItemsContainer.innerHTML = '';
    let total = 0;

    if (cart.length === 0) {
        cartModalItemsContainer.innerHTML = '<p style="color:var(--text-faded);">El carrito está vacío.</p>';
        cartModalTotalSpan.textContent = '0.00';
    } else {
        cart.forEach(item => {
            const itemEl = document.createElement('div');
            itemEl.style.display = 'flex';
            itemEl.style.justifyContent = 'space-between';
            itemEl.style.padding = '8px 0';
            itemEl.style.borderBottom = '1px solid #333';
            itemEl.innerHTML = `
                <span>Foto: ${item.student_code} ($${item.price})</span>
                <span style="color:#f00; cursor:pointer;" onclick="removeFromCart('${item.id}')">&times;</span>
            `;
            cartModalItemsContainer.appendChild(itemEl);
            total += item.price;
        });
        cartModalTotalSpan.textContent = total.toFixed(2);
    }
}

function addToCart(photo) {
    const cart = getCart();
    // Prevenir duplicados (si ya existe una foto con el mismo ID)
    if (!cart.find(item => item.id === photo.id)) {
        cart.push({
            id: photo.id,
            student_code: photo.student_code,
            price: photo.price
        });
        saveCart(cart);
        updateCartUI();
    }
}

function removeFromCart(photoId) {
    const cart = getCart().filter(item => item.id !== photoId);
    saveCart(cart);
    updateCartUI();
}

function checkoutCart() {
    if (getCart().length === 0) {
        alert("El carrito está vacío. Agregá fotos antes de continuar.");
        return;
    }
    hideCartModal();
    showCartEmailModal();
}

function confirmCartPurchase() {
    const email = document.getElementById("cartEmailInput").value;
    if (!email || !email.includes('@') || !email.includes('.')) {
        alert("Por favor, ingresá un email válido.");
        return;
    }

    // Simulación de finalización de compra
    alert(`Compra simulada. Email: ${email}. Total: $${cartModalTotalSpan.textContent}. El carrito se vaciará.`);
    localStorage.removeItem("cart");
    updateCartUI();
    hideCartEmailModal();
}

/* ===== MODALES (Implementación de funciones faltantes) ===== */

function showCartModal() {
    updateCartUI();
    cartModal.classList.remove("hidden");
}

function hideCartModal(){
    cartModal.classList.add("hidden");
}

function showCartEmailModal() {
    document.getElementById("cart-email-modal").classList.remove("hidden");
}

function hideCartEmailModal(){
    document.getElementById("cart-email-modal").classList.add("hidden");
}

function hidePhotoDetailModal(){
    document.getElementById("photo-detail-modal").classList.add("hidden");
}

/* ===== FUNCIONES ORIGINALES ===== */

// Función de simulación para cargar el primer álbum (para evitar fallo de la llamada API)
async function autoLoadFirstAlbum() {
    // Simulación de un álbum de muestra
    const mockAlbumId = 'MOCK-001';
    const mockAlbumName = 'Clase 2024 - Primaria';
    const mockPhotos = [
        { id: 1, student_code: 'A001', price: 15.00, public_watermarked_url: 'https://picsum.photos/id/10/300/200' },
        { id: 2, student_code: 'A002', price: 15.00, public_watermarked_url: 'https://picsum.photos/id/20/300/200' },
        { id: 3, student_code: 'A003', price: 15.00, public_watermarked_url: 'https://picsum.photos/id/30/300/200' },
        { id: 4, student_code: 'A004', price: 15.00, public_watermarked_url: 'https://picsum.photos/id/40/300/200' },
    ];

    await new Promise(resolve => setTimeout(resolve, 500)); // Simula la espera de la carga

    loadingGlobal.classList.add("hidden");
    contentAfterSearch.classList.remove("hidden");

    galleryTitle.textContent = `Fotos del Álbum: ${mockAlbumName}`;
    galleryContainer.innerHTML = "";
    noPhotosMessage.classList.add("hidden");

    mockPhotos.forEach(photo => {
        const el = document.createElement("div");
        el.className = "photo-item";

        el.innerHTML = `
            <img src="${photo.public_watermarked_url}" onerror="this.onerror=null;this.src='https://placehold.co/300x200/202020/FFF?text=Foto+${photo.id}'">
            <div style="padding:10px;">
                <p>Código: ${photo.student_code || "N/A"}</p>
                <p>Precio: $${photo.price}</p>
                <button class="btn-primary" data-id="${photo.id}">Ver / Comprar</button>
            </div>
        `;

        el.querySelector("button").onclick = () => showPhotoDetailModal(photo);
        galleryContainer.appendChild(el);
    });
}


async function loadAlbumPhotos(albumId, albumName) {
    try {
        // En un entorno real, la llamada a la API iría aquí
        // const res = await fetch(`${BACKEND_URL}/albums/${albumId}/photos`);
        // const data = await res.json();
        
        // Dado que el backend no está disponible, simulamos la respuesta para evitar errores.
        const mockData = {
             photos: [
                { id: 5, student_code: 'B005', price: 12.00, public_watermarked_url: 'https://picsum.photos/id/50/300/200' },
                { id: 6, student_code: 'B006', price: 12.00, public_watermarked_url: 'https://picsum.photos/id/60/300/200' },
            ]
        };
        
        const data = mockData;

        loadingGlobal.classList.add("hidden");
        contentAfterSearch.classList.remove("hidden");

        galleryTitle.textContent = `Fotos del Álbum: ${albumName}`;
        galleryContainer.innerHTML = "";

        if (!data.photos || data.photos.length === 0) {
            noPhotosMessage.classList.remove("hidden");
            return;
        }

        noPhotosMessage.classList.add("hidden");

        data.photos.forEach(photo => {
            const el = document.createElement("div");
            el.className = "photo-item";

            el.innerHTML = `
                <img src="${photo.public_watermarked_url}" onerror="this.onerror=null;this.src='https://placehold.co/300x200/202020/FFF?text=Foto+${photo.id}'">
                <div style="padding:10px;">
                    <p>Código: ${photo.student_code || "N/A"}</p>
                    <p>Precio: $${photo.price}</p>
                    <button class="btn-primary" data-id="${photo.id}">Ver / Comprar</button>
                </div>
            `;

            el.querySelector("button").onclick = () => showPhotoDetailModal(photo);
            galleryContainer.appendChild(el);
        });

    } catch (err) {
        galleryContainer.innerHTML = `<p class="message">Error cargando fotos: ${err.message}</p>`;
    }
}

function showPhotoDetailModal(photo) {
    document.getElementById("modal-photo-img").src = photo.public_watermarked_url;
    document.getElementById("modal-photo-title").textContent = `Código ${photo.student_code}`;
    document.getElementById("modal-photo-price").textContent = `$${photo.price}`;

    document.getElementById("modal-add-to-cart-btn").onclick = () => {
        addToCart(photo);
        hidePhotoDetailModal();
    };

    document.getElementById("photo-detail-modal").classList.remove("hidden");
}


/* ===== CARRUSEL (Original) ===== */
const workshopData = [
    { title: "Studio Lighting Mastery", instructor: "EVA M.", imgId: 400 },
    { title: "Drone Video Techniques", instructor: "LIAM K.", imgId: 409 },
    { title: "Advanced Post Production", instructor: "JAY L.", imgId: 420 },
    { title: "Cinematic Look Grading", instructor: "ANNA R.", imgId: 440 },
    { title: "HDR Techniques Pro", instructor: "CHRIS T.", imgId: 460 },
    { title: "Flash Portrait Essentials", instructor: "MÍA G.", imgId: 470 },
];

let currentSlide = 0;
const carouselContainer = document.getElementById('carouselSlides');

function renderCarousel() {
    if (!carouselContainer) return;

    workshopData.forEach((item, index) => {
        const slide = document.createElement('div');
        slide.className = 'carousel-slide';
        if (index === 0) slide.classList.add('active');

        // Usando una URL de imagen de respaldo con picsum.photos
        const imageUrl = `https://picsum.photos/id/${item.imgId}/1200/600`;
        slide.style.backgroundImage = `url('${imageUrl}')`;

        slide.innerHTML = `
            <div class="slide-info">
                <h4>${item.title}</h4>
                <p>${item.instructor}</p>
            </div>
        `;
        carouselContainer.appendChild(slide);
    });

    const slides = document.querySelectorAll('#carouselSlides .carousel-slide');
    const totalSlides = slides.length;

    function nextSlide() {
        slides[currentSlide].classList.remove('active');
        currentSlide = (currentSlide + 1) % totalSlides;
        slides[currentSlide].classList.add('active');
    }

    setInterval(nextSlide, 5000);
}

/* ===== INIT (Original) ===== */
document.addEventListener("DOMContentLoaded", ()=>{
    updateCartUI();
    autoLoadFirstAlbum(); // Mock: carga datos de ejemplo para evitar error de API
    renderCarousel();
});
