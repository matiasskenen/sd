const BACKEND_URL = "https://school-photos-backend.onrender.com";

const purchasedPhotosContainer = document.getElementById("purchased-photos-container");
const statusMessageDiv = document.getElementById("status-message");
const loadingPhotosDiv = document.getElementById("loading-photos");

const showMessage = (msg, type) => {
    statusMessageDiv.textContent = msg;
    statusMessageDiv.className = "message";
    statusMessageDiv.classList.add(type);
    statusMessageDiv.classList.remove("hidden");
};

const setLoading = (isLoading) => {
    loadingPhotosDiv.classList.toggle("hidden", !isLoading);
};

const getUrlParameter = (name) => {
    name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
    const regex = new RegExp("[\\?&]" + name + "=([^&#]*)");
    const results = regex.exec(location.search);
    return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
};

async function sendEmailNotification(toEmail, orderId, photosCount) {
    try {
        const sentKey = `email_sent_${orderId}`;
        if (localStorage.getItem(sentKey)) return; // ya se envió

        const downloadPageLink = `${window.location.origin}${window.location.pathname}?orderId=${orderId}&customerEmail=${encodeURIComponent(toEmail)}`;

        const resp = await emailjs.send(
            "service_tiv2evg", // tu Service ID
            "template_2hnwv6k", // tu Template ID
            {
                to_email: toEmail,
                order_id: orderId,
                photos_count: photosCount,
                expires_days: 7,
                download_link: downloadPageLink,
                title: "Gracias por tu compra – Aquí están tus fotos",
            },
            "YZushknE7WC3BOxhw" // tu Public Key
        );

        console.log("✅ Email enviado:", resp.status, resp.text);
        localStorage.setItem(sentKey, "1");
    } catch (err) {
        console.error("❌ Error enviando email:", err);
    }
}

async function fetchOrderDetailsWithRetry(orderId, customerEmail, maxRetries = 12, delay = 5000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(`${BACKEND_URL}/order-details/${orderId}/${customerEmail}`);
            const data = await response.json();

            if (!response.ok) {
                showMessage(`Error: ${data.message || "Desconocido"}`, "error");
                return;
            }

            if (data.order?.status === "paid" && data.photos?.length > 0) {
                // ⏳ Verificar expiración
                if (data.order.download_expires_at) {
                    const now = new Date();
                    const expiresAt = new Date(data.order.download_expires_at);

                    if (now > expiresAt) {
                        purchasedPhotosContainer.innerHTML = `
                                <div class="message error">
                                    El link de descarga expiró el ${expiresAt.toLocaleDateString("es-AR")} 
                                    a las ${expiresAt.toLocaleTimeString("es-AR")}.
                                    Por favor contacta a soporte.
                                </div>
                            `;
                        return; // 👈 no muestra fotos
                    } else {
                        showMessage(
                            `¡Se encontraron ${data.photos.length} fotos para descargar! 
                                 Válidas hasta el ${expiresAt.toLocaleDateString("es-AR")} ${expiresAt.toLocaleTimeString("es-AR")}`,
                            "success"
                        );
                    }
                }

                // Render de fotos compradas
                purchasedPhotosContainer.innerHTML = "";
                data.photos.forEach((photo) => {
                    const photoItem = document.createElement("div");
                    photoItem.className = "photo-item";
                    photoItem.innerHTML = `
                          <img src="${photo.watermarked_url}" alt="Foto Comprada">
                          <p class="text-sm text-gray-700 mb-2">Código: ${photo.student_code || "N/A"}</p>
                          <a href="${BACKEND_URL}/download-photo/${photo.id}/${orderId}/${customerEmail}" class="btn-primary text-sm inline-block">Descargar Imagen</a>
                        `;
                    purchasedPhotosContainer.appendChild(photoItem);
                });

                // 📧 Enviar email (una sola vez)
                await sendEmailNotification(customerEmail, orderId, data.photos.length);

                return; // listo
            } else {
                showMessage(`Intento ${attempt}/${maxRetries}: Esperando confirmación de pago...`, "info");
            }
        } catch (error) {
            showMessage(`Error de conexión: ${error.message}`, "error");
            console.error(error);
            return;
        }

        await new Promise((res) => setTimeout(res, delay)); // esperar y reintentar
    }

    showMessage("Tiempo de espera agotado. Si ya pagaste, recarga la página en unos minutos.", "error");
}

document.addEventListener("DOMContentLoaded", () => {
    const orderId = getUrlParameter("orderId");
    const customerEmail = getUrlParameter("customerEmail");

    if (!orderId || !customerEmail) {
        showMessage("Error: Falta información de la orden.", "error");
        return;
    }

    setLoading(true);
    fetchOrderDetailsWithRetry(orderId, customerEmail).finally(() => setLoading(false));
});
