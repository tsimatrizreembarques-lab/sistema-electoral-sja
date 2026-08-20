const VISTAS = {
  login: window.renderLogin,
  comando: window.renderComando,
  mesa: window.renderMesa,
  concejal: window.renderConcejal,
  admin: window.renderAdmin,
};

async function irA(nombreVista) {
  const root = document.getElementById('app');
  const sesion = await window.DBLocal.obtenerSesion();

  if (nombreVista !== 'login' && !sesion) {
    return irA('login');
  }

  const render = VISTAS[nombreVista];
  if (!render) return irA('login');

  await render(root, sesion?.perfil);
}

async function iniciar() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch((e) => console.error('SW error', e));
  }

  const sesion = await window.DBLocal.obtenerSesion();
  irA(sesion ? sesion.perfil.rol : 'login');
}

window.App = { irA };
window.addEventListener('DOMContentLoaded', iniciar);
