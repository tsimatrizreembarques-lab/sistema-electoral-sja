// Almacenamiento local del dispositivo (IndexedDB). Cada dispositivo es
// independiente: guarda su propia porcion de padron/preasignaciones para
// poder buscar cedulas sin conexion, y una cola de registros pendientes
// de sincronizar cuando recupera seal.

const DB_NAME = 'electoral-sja-local';
const DB_VERSION = 2;

/** Mayusculas, sin acentos, sin espacios de mas — para comparar nombres. */
function normalizarTexto(texto) {
  return String(texto ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      const tx = req.transaction;

      let padronStore;
      if (!db.objectStoreNames.contains('padron')) {
        padronStore = db.createObjectStore('padron', { keyPath: 'cedula' });
      } else if (tx) {
        padronStore = tx.objectStore('padron');
      }
      if (padronStore && !padronStore.indexNames.contains('porOrden')) {
        padronStore.createIndex('porOrden', 'orden', { unique: false });
      }

      if (!db.objectStoreNames.contains('votantesConcejal')) {
        // multiples entradas por cedula posibles -> keyPath compuesto
        const store = db.createObjectStore('votantesConcejal', { keyPath: ['cedula', 'nombreConcejal'] });
        store.createIndex('porCedula', 'cedula', { unique: false });
      }
      if (!db.objectStoreNames.contains('registros')) {
        db.createObjectStore('registros', { keyPath: 'cedula' });
      }
      if (!db.objectStoreNames.contains('colaPendiente')) {
        db.createObjectStore('colaPendiente', { keyPath: 'idLocal', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('sesion')) {
        db.createObjectStore('sesion', { keyPath: 'clave' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(storeName, modo, fn) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, modo);
    const store = t.objectStore(storeName);
    const resultado = fn(store);
    t.oncomplete = () => resolve(resultado);
    t.onerror = () => reject(t.error);
  });
}

async function limpiarYCargar(storeName, items) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readwrite');
    const store = t.objectStore(storeName);
    store.clear();
    for (const item of items) store.put(item);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

async function getTodos(storeName) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readonly');
    const req = t.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getPorClave(storeName, clave) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readonly');
    const req = t.objectStore(storeName).get(clave);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function getPorIndice(storeName, indexName, valor) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readonly');
    const req = t.objectStore(storeName).index(indexName).getAll(valor);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getPorIndiceUnico(storeName, indexName, valor) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readonly');
    const req = t.objectStore(storeName).index(indexName).get(valor);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function put(storeName, item) {
  return tx(storeName, 'readwrite', (store) => store.put(item));
}

async function eliminar(storeName, clave) {
  return tx(storeName, 'readwrite', (store) => store.delete(clave));
}

// --- API de alto nivel usada por las vistas ---

const DBLocal = {
  async guardarPaqueteInicial({ padron, votantesConcejal, registros }) {
    await limpiarYCargar('padron', padron);
    await limpiarYCargar('votantesConcejal', votantesConcejal);
    await limpiarYCargar('registros', registros);
  },

  async buscarVotante(cedula) {
    const padron = await getPorClave('padron', cedula);
    if (!padron) return null;
    const preasignados = await getPorIndice('votantesConcejal', 'porCedula', cedula);
    const registroActual = await getPorClave('registros', cedula);
    return {
      cedula,
      nombresApellidos: padron.nombresApellidos,
      local: padron.local,
      mesa: padron.mesa,
      orden: padron.orden,
      preasignados,
      duplicadoAmbiguo: preasignados.length > 1,
      registroActual,
    };
  },

  async buscarVotantePorOrden(orden) {
    const padron = await getPorIndiceUnico('padron', 'porOrden', Number(orden));
    if (!padron) return null;
    return this.buscarVotante(padron.cedula);
  },

  /**
   * Busca por apellido/nombre (parcial, sin importar el orden de las
   * palabras ni mayusculas/acentos). Recorre todo el padron local (es chico:
   * el de una mesa/local), asi que no hace falta un indice especial.
   * Devuelve varias coincidencias posibles, no una sola.
   */
  async buscarVotantesPorNombre(texto) {
    const palabras = normalizarTexto(texto).split(/\s+/).filter(Boolean);
    if (palabras.length === 0) return [];

    const todos = await getTodos('padron');
    return todos
      .filter((p) => {
        const nombre = normalizarTexto(p.nombresApellidos);
        return palabras.every((palabra) => nombre.includes(palabra));
      })
      .sort((a, b) => (a.nombresApellidos || '').localeCompare(b.nombresApellidos || ''))
      .slice(0, 30);
  },

  /**
   * Guarda en el cache local un votante que no estaba en el paquete
   * descargado al iniciar sesion (ej. se agrego al padron despues). Asi
   * queda disponible offline de ahi en mas, sin esperar a un nuevo login.
   */
  async guardarVotanteDescubierto({ cedula, orden, nombresApellidos, local, mesa, preasignados, registroActual }) {
    await put('padron', { cedula, orden, nombresApellidos, local, mesa });
    for (const p of preasignados || []) {
      await put('votantesConcejal', p);
    }
    if (registroActual) {
      await put('registros', registroActual);
    }
  },

  async marcarRegistradoLocalmente(registro) {
    await put('registros', registro);
  },

  async encolarRegistro(item) {
    return tx('colaPendiente', 'readwrite', (store) => store.add(item));
  },

  async obtenerCola() {
    return getTodos('colaPendiente');
  },

  async quitarDeCola(idLocal) {
    return eliminar('colaPendiente', idLocal);
  },

  async guardarSesion(perfil, token) {
    await put('sesion', { clave: 'actual', perfil, token });
  },

  async obtenerSesion() {
    return getPorClave('sesion', 'actual');
  },

  async cerrarSesion() {
    await eliminar('sesion', 'actual');
  },
};

window.DBLocal = DBLocal;

// Formatea una fecha ISO (UTC) a hora local de Paraguay (America/Asuncion)
window.formatearFechaPY = function (iso) {
  if (!iso) return '';
  try {
    const fecha = new Date(iso);
    return fecha.toLocaleString('es-PY', {
      timeZone: 'America/Asuncion',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  } catch (e) {
    return iso;
  }
};

// Arma un listado legible del historial de intentos de registro de un votante
// (registro.historial: cada intento de comando, mesa o concejal, exitoso o no).
window.formatearHistorial = function (historial) {
  if (!Array.isArray(historial) || historial.length === 0) return '';
  const etiquetas = { REGISTRO: 'Registrado', FORZADO: 'Registrado (forzado)', INTENTO_BLOQUEADO: 'Intento bloqueado' };
  return historial
    .slice()
    .sort((a, b) => new Date(a.fechaHora) - new Date(b.fechaHora))
    .map((h, i) => {
      const etiqueta = etiquetas[h.tipo] || h.tipo || '';
      const detalle = h.origenRegistro || h.origenIntento || '';
      return `${i + 1}. ${etiqueta} — ${detalle} (${window.formatearFechaPY(h.fechaHora)})`;
    })
    .join('\n');
};
