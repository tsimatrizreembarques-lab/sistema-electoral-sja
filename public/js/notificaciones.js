// Modales propios de la app (fondo difuminado) en vez de los dialogos nativos
// del navegador (alert/confirm), que se ven genericos y no se pueden estilar.
//
// mostrarModal(): aviso con un solo boton "Entendido" (reemplaza alert()).
// confirmarModal(): pregunta con Cancelar/Confirmar, devuelve una Promise<boolean>
//   que resuelve segun lo que toque la persona (reemplaza confirm()).
//
// avisar() ademas dispara una notificacion del sistema operativo (si el
// usuario dio permiso), util para cuando el dispositivo esta minimizado.
// Usa showNotification() vía el service worker, que es el unico metodo
// soportado en Chrome Android (el constructor "new Notification()" esta
// bloqueado ahi).

async function pedirPermisoNotificaciones() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    const resultado = await Notification.requestPermission();
    return resultado === 'granted';
  } catch (e) {
    return false;
  }
}

function crearOverlay(contenidoHTML) {
  const existente = document.getElementById('aviso-modal-overlay');
  if (existente) existente.remove();

  const overlay = document.createElement('div');
  overlay.id = 'aviso-modal-overlay';
  overlay.className = 'aviso-modal-overlay';
  overlay.innerHTML = `<div class="aviso-modal-caja">${contenidoHTML}</div>`;
  document.body.appendChild(overlay);
  return overlay;
}

function mostrarModal(titulo, mensaje) {
  const overlay = crearOverlay(`
    <h3>⚠ ${titulo}</h3>
    <p>${mensaje}</p>
    <button type="button" class="btn-registrar" id="aviso-modal-cerrar">Entendido</button>
  `);

  const cerrar = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cerrar();
  });
  document.getElementById('aviso-modal-cerrar').addEventListener('click', cerrar);
}

function confirmarModal(titulo, mensaje, textoConfirmar = 'Confirmar') {
  return new Promise((resolve) => {
    const overlay = crearOverlay(`
      <h3>${titulo}</h3>
      <p>${mensaje}</p>
      <div class="aviso-modal-botones">
        <button type="button" class="btn-eliminar" id="aviso-modal-cancelar">Cancelar</button>
        <button type="button" class="btn-registrar" id="aviso-modal-confirmar">${textoConfirmar}</button>
      </div>
    `);

    const cerrar = (valor) => {
      overlay.remove();
      resolve(valor);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cerrar(false);
    });
    document.getElementById('aviso-modal-cancelar').addEventListener('click', () => cerrar(false));
    document.getElementById('aviso-modal-confirmar').addEventListener('click', () => cerrar(true));
  });
}

async function avisar(titulo, cuerpo) {
  mostrarModal(titulo, cuerpo);

  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification(titulo, {
      body: cuerpo,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    });
  } catch (e) {
    // Silencioso: el modal en pantalla ya muestra la misma info.
  }
}

window.Notificaciones = { pedirPermisoNotificaciones, avisar, mostrarModal, confirmarModal };

/**
 * Escapa texto para meterlo en innerHTML. Obligatorio para todo lo que
 * escribe un usuario (caudillo, telefono, direccion): sin esto, un texto
 * con etiquetas HTML se ejecutaria en el dispositivo de quien lo mira
 * (incluido el admin al generar sus reportes).
 */
function escaparHTML(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Link de WhatsApp para un telefono paraguayo. Acepta "0981 123 456",
 * "981123456", "+595 981 123456", etc. Devuelve null si no hay numero.
 */
function enlaceWhatsApp(telefono) {
  let digitos = String(telefono ?? '').replace(/\D/g, '');
  if (!digitos) return null;
  if (digitos.startsWith('595')) {
    // ya tiene codigo de pais
  } else if (digitos.startsWith('0')) {
    digitos = `595${digitos.slice(1)}`;
  } else if (digitos.length === 9) {
    digitos = `595${digitos}`;
  }
  return `https://wa.me/${digitos}`;
}

/**
 * Modal con campos de texto. campos: [{ id, etiqueta, valor, tipo, inputmode }]
 * Devuelve una Promise con { id: valor } al guardar, o null si se cancela.
 */
function formularioModal(titulo, campos, textoConfirmar = 'Guardar') {
  return new Promise((resolve) => {
    const overlay = crearOverlay(`
      <h3>${escaparHTML(titulo)}</h3>
      <form id="aviso-modal-form" class="formulario-modal">
        ${campos
          .map(
            (c) => `
          <label>${escaparHTML(c.etiqueta)}
            <input type="${c.tipo || 'text'}" name="${c.id}" value="${escaparHTML(c.valor)}"
              ${c.inputmode ? `inputmode="${c.inputmode}"` : ''} placeholder="${escaparHTML(c.placeholder || '')}" />
          </label>`
          )
          .join('')}
        <div class="aviso-modal-botones">
          <button type="button" class="btn-eliminar" id="aviso-modal-cancelar">Cancelar</button>
          <button type="submit" class="btn-registrar">${escaparHTML(textoConfirmar)}</button>
        </div>
      </form>
    `);

    const cerrar = (valor) => {
      overlay.remove();
      resolve(valor);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cerrar(null);
    });
    document.getElementById('aviso-modal-cancelar').addEventListener('click', () => cerrar(null));
    document.getElementById('aviso-modal-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const datos = {};
      campos.forEach((c) => { datos[c.id] = e.target.elements[c.id].value.trim(); });
      cerrar(datos);
    });
  });
}

window.Notificaciones.formularioModal = formularioModal;
window.escaparHTML = escaparHTML;
window.enlaceWhatsApp = enlaceWhatsApp;
