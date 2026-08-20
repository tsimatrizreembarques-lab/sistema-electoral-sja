// Aviso local (no requiere servidor de push): cuando el dispositivo que esta
// buscando/registrando detecta que un votante ya fue registrado en otro
// lugar, ademas del mensaje en pantalla se dispara una notificacion del
// sistema operativo. Usa showNotification() vía el service worker, que es
// el unico metodo soportado en Chrome Android (el constructor "new
// Notification()" esta bloqueado ahi).

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

async function avisar(titulo, cuerpo) {
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
    // Silencioso: el aviso en pantalla ya muestra la misma info.
  }
}

window.Notificaciones = { pedirPermisoNotificaciones, avisar };
