document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const loginButton = document.getElementById('loginButton');
    const messageDiv = document.getElementById('message');
    const loadingDiv = document.getElementById('loading');

    // Función para mostrar mensajes (similar a la de upload.js)
    const showMessage = (msg, type) => {
        messageDiv.textContent = msg;
        messageDiv.className = '';
        if (type) {
            messageDiv.classList.add(type);
        }
    };

    // Función para mostrar/ocultar spinner de carga
    const setLoading = (isLoading) => {
        loadingDiv.style.display = isLoading ? 'block' : 'none';
        loginButton.disabled = isLoading;
        emailInput.disabled = isLoading;
        passwordInput.disabled = isLoading;
    };

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault(); // Evita que el formulario se recargue

        const email = emailInput.value.trim();
        const password = passwordInput.value.trim();

        if (!email || !password) {
            showMessage('Por favor, ingresa tu email y contraseña.', 'error');
            return;
        }

        setLoading(true); // Muestra el spinner de carga
        showMessage('', ''); // Limpia mensajes anteriores

        try {
            const response = await fetch('http://localhost:3000/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (response.ok) {
                showMessage('Inicio de sesión exitoso. Redirigiendo...', 'success');
                // Almacenar el token de acceso JWT de forma segura
                // localStorage es suficiente para este tipo de aplicación web (SPA)
                localStorage.setItem('supabaseAccessToken', data.session.access_token);
                // Opcional: localStorage.setItem('supabaseRefreshToken', data.session.refresh_token);

                // Redirigir al usuario a la página de subida de fotos (index.html)
                // Usamos un pequeño retraso para que el usuario vea el mensaje de éxito
                setTimeout(() => {
                    window.location.href = 'updload.html'; // Redirige a la página principal del fotógrafo
                }, 1500);

            } else {
                showMessage(`Error al iniciar sesión: ${data.message || 'Error desconocido'}`, 'error');
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