async function renderLogin(root) {
  root.innerHTML = `
    <div class="pantalla-login">
      <h1>Control Electoral SJA</h1>
      <form id="form-login" class="tarjeta">
        <label>Usuario
          <input id="usuario" type="text" autocomplete="username" required />
        </label>
        <label>Contraseña
          <input id="password" type="password" autocomplete="current-password" required />
        </label>
        <p id="error-login" class="error oculto"></p>
        <button type="submit">Ingresar</button>
      </form>
    </div>
  `;

  document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const usuario = document.getElementById('usuario').value.trim();
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('error-login');
    errorEl.classList.add('oculto');

    if (!navigator.onLine) {
      errorEl.textContent = 'Necesitás conexión a internet para iniciar sesión la primera vez.';
      errorEl.classList.remove('oculto');
      return;
    }

    const { ok, datos } = await window.Api.login(usuario, password);
    if (!ok) {
      errorEl.textContent = datos.error || 'No se pudo iniciar sesión.';
      errorEl.classList.remove('oculto');
      return;
    }

    await window.DBLocal.guardarSesion(datos.perfil, datos.token);

    // Para roles de campo, descargamos el paquete local para poder operar offline.
    if (['comando', 'mesa'].includes(datos.perfil.rol)) {
      const paquete = await window.Api.descargarPaqueteLocal();
      if (paquete.ok) {
        await window.DBLocal.guardarPaqueteInicial(paquete.datos);
      }
    }

    window.App.irA(datos.perfil.rol);
  });
}

window.renderLogin = renderLogin;
