const VISTAS = {
  login: window.renderLogin,
  comando: window.renderComando,
  mesa: window.renderMesa,
  concejal: window.renderConcejal,
  admin: window.renderAdmin,
};

// Intervalos de refresco de la vista actual. Se cortan al cambiar de vista:
// antes seguian corriendo despues de "Salir" (pidiendo datos con la sesion de
// otro usuario y rompiendo al no encontrar los elementos de la pantalla vieja).
let intervalosVista = [];

function intervaloDeVista(fn, ms) {
  intervalosVista.push(setInterval(fn, ms));
}

async function irA(nombreVista) {
  intervalosVista.forEach(clearInterval);
  intervalosVista = [];

  const root = document.getElementById('app');
  const sesion = await window.DBLocal.obtenerSesion();

  if (nombreVista !== 'login' && !sesion) {
    return irA('login');
  }

  const render = VISTAS[nombreVista];
  if (!render) return irA('login');

  await render(root, sesion?.perfil);
}

/**
 * Cierra la sesion. Si el dispositivo tiene registros sin sincronizar, avisa
 * antes: quedan guardados y se envian al volver a entrar, pero conviene que
 * vuelva a entrar el MISMO puesto (se envian con la sesion de quien entre).
 */
async function salir() {
  const cola = await window.DBLocal.obtenerCola();
  if (cola.length > 0) {
    const confirmado = await window.Notificaciones.confirmarModal(
      'Hay registros sin enviar',
      `Este dispositivo tiene ${cola.length} registro(s) que todavía no llegaron al servidor. ` +
        'Quedan guardados y se envían cuando vuelvas a entrar con este mismo usuario. ¿Salir igual?',
      'Salir'
    );
    if (!confirmado) return;
  }
  await window.DBLocal.cerrarSesion();
  irA('login');
}

async function iniciar() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch((e) => console.error('SW error', e));
  }

  const sesion = await window.DBLocal.obtenerSesion();
  irA(sesion ? sesion.perfil.rol : 'login');
}

window.App = { irA, salir, intervaloDeVista };
window.addEventListener('DOMContentLoaded', iniciar);
