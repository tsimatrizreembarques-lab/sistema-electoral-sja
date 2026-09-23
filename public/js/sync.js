// Sincroniza la cola local pendiente contra el servidor apenas hay señal.
// Se dispara: al recuperar conexion (evento 'online'), cada cierto intervalo
// mientras la app esta abierta, y manualmente desde las vistas tras cada
// registro (por si ya hay señal en ese instante).

let sincronizando = false;
let syncIniciado = false;
let onCambioEstado = () => {};

async function sincronizarAhora() {
  if (sincronizando) return;
  if (!navigator.onLine) return;

  // Sin sesion (ej. despues de "Salir") no se intenta: la cola se conserva
  // y se envia cuando vuelva a entrar alguien.
  const sesion = await window.DBLocal.obtenerSesion();
  if (!sesion?.token) return;

  sincronizando = true;
  onCambioEstado({ estado: 'sincronizando' });

  try {
    const cola = await window.DBLocal.obtenerCola();
    if (cola.length === 0) {
      onCambioEstado({ estado: 'al-dia', pendientes: 0 });
      return;
    }

    const { ok, status, datos } = await window.Api.sincronizarCola(cola);
    if (!ok) {
      // 401 = la sesion vencio: no es falta de señal, hay que volver a entrar.
      onCambioEstado({ estado: status === 401 ? 'sesion-vencida' : 'error', pendientes: cola.length });
      return;
    }

    let conflictos = 0;
    for (const resultado of datos.resultados || []) {
      if (resultado.ok) {
        await window.DBLocal.quitarDeCola(resultado.idLocal);
        if (resultado.registro) {
          await window.DBLocal.marcarRegistradoLocalmente(resultado.registro);
        }
      } else if (resultado.codigo === 409 || resultado.codigo === 404) {
        // 409: alguien ya lo habia registrado. 404: la cedula no esta en el
        // padron. En ambos casos reintentar no sirve: se quita de la cola.
        await window.DBLocal.quitarDeCola(resultado.idLocal);
        if (resultado.registroExistente) {
          await window.DBLocal.marcarRegistradoLocalmente(resultado.registroExistente);
        }
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

/**
 * Arranca la sincronizacion automatica UNA sola vez por carga de la app;
 * si se vuelve a llamar (al volver a entrar a una vista) solo cambia a quien
 * se le avisa. Antes cada visita a la vista sumaba otro intervalo y otro
 * listener 'online'.
 */
function iniciarSyncAutomatico(callback) {
  onCambioEstado = callback || onCambioEstado;
  if (!syncIniciado) {
    syncIniciado = true;
    window.addEventListener('online', sincronizarAhora);
    setInterval(sincronizarAhora, 20000); // reintento cada 20s mientras la app esta abierta
  }
  sincronizarAhora();
}

/** Texto del indicador de sincronizacion, compartido por Comando y Mesa. */
function textoEstadoSync({ estado, pendientes }) {
  if (estado === 'sincronizando') return 'Sincronizando…';
  if (estado === 'al-dia') return 'Todo sincronizado';
  if (estado === 'sincronizado') return pendientes > 0 ? `${pendientes} pendientes` : 'Todo sincronizado';
  if (estado === 'sesion-vencida') return 'Sesión vencida: salí y volvé a entrar';
  if (estado === 'error') return 'Sin conexión (guardando local)';
  return '—';
}

window.Sync = { sincronizarAhora, iniciarSyncAutomatico, textoEstadoSync };
