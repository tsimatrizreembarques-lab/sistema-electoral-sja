// Sincroniza la cola local pendiente contra el servidor apenas hay señal.
// Se dispara: al recuperar conexion (evento 'online'), cada cierto intervalo
// mientras la app esta abierta, y manualmente desde las vistas tras cada
// registro (por si ya hay señal en ese instante).

let sincronizando = false;
let onCambioEstado = () => {};

async function sincronizarAhora() {
  if (sincronizando) return;
  if (!navigator.onLine) return;

  sincronizando = true;
  onCambioEstado({ estado: 'sincronizando' });

  try {
    const cola = await window.DBLocal.obtenerCola();
    if (cola.length === 0) {
      onCambioEstado({ estado: 'al-dia', pendientes: 0 });
      return;
    }

    const { ok, datos } = await window.Api.sincronizarCola(cola);
    if (!ok) {
      onCambioEstado({ estado: 'error', pendientes: cola.length });
      return;
    }

    let conflictos = 0;
    for (const resultado of datos.resultados || []) {
      if (resultado.ok) {
        await window.DBLocal.quitarDeCola(resultado.idLocal);
        if (resultado.registro) {
          await window.DBLocal.marcarRegistradoLocalmente(resultado.registro);
        }
      } else if (resultado.codigo === 409) {
        // Conflicto real: alguien ya lo habia registrado. Se quita de la cola
        // igual (no tiene sentido reintentar) y se avisa para revision manual.
        await window.DBLocal.quitarDeCola(resultado.idLocal);
        conflictos += 1;
      }
      // Otros errores (500, etc.): se deja en la cola para reintentar despues.
    }

    const colaRestante = await window.DBLocal.obtenerCola();
    onCambioEstado({ estado: 'sincronizado', pendientes: colaRestante.length, conflictos });
  } catch (error) {
    console.error('Error al sincronizar:', error);
    onCambioEstado({ estado: 'error' });
  } finally {
    sincronizando = false;
  }
}

function iniciarSyncAutomatico(callback) {
  onCambioEstado = callback || onCambioEstado;
  window.addEventListener('online', sincronizarAhora);
  setInterval(sincronizarAhora, 20000); // reintento cada 20s mientras la app esta abierta
  sincronizarAhora();
}

window.Sync = { sincronizarAhora, iniciarSyncAutomatico };
