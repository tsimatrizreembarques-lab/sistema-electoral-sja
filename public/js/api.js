const Api = {
  async _fetch(path, opciones = {}) {
    const sesion = await window.DBLocal.obtenerSesion();
    const headers = { 'Content-Type': 'application/json', ...(opciones.headers || {}) };
    if (sesion?.token) headers.Authorization = `Bearer ${sesion.token}`;

    let respuesta;
    try {
      respuesta = await fetch(path, { ...opciones, headers });
    } catch (error) {
      // Sin señal: fetch rechaza. Se devuelve como error normal para que las
      // vistas muestren su mensaje en vez de quedar colgadas con una excepcion.
      return { status: 0, ok: false, datos: { error: 'Sin conexión. Intentá de nuevo cuando haya señal.' } };
    }
    const datos = await respuesta.json().catch(() => ({}));
    return { status: respuesta.status, ok: respuesta.ok, datos };
  },

  login(usuario, password) {
    return this._fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ usuario, password }),
    });
  },

  descargarPaqueteLocal() {
    return this._fetch('/api/votantes/paquete-local/descargar');
  },

  buscarVotante(cedula) {
    return this._fetch(`/api/votantes/${encodeURIComponent(cedula)}`);
  },

  listarConcejales() {
    return this._fetch('/api/votantes/concejales');
  },

  registrarVotante(payload) {
    return this._fetch('/api/votantes/registrar', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  sincronizarCola(registros) {
    return this._fetch('/api/votantes/sync', {
      method: 'POST',
      body: JSON.stringify({ registros }),
    });
  },

  dashboardAdmin() {
    return this._fetch('/api/dashboard/admin');
  },

  dashboardAdminListas() {
    return this._fetch('/api/dashboard/admin/listas');
  },

  dashboardAdminDuplicados() {
    return this._fetch('/api/dashboard/admin/duplicados');
  },

  dashboardConcejal() {
    return this._fetch('/api/dashboard/concejal');
  },

  concejalBuscar(cedula) {
    return this._fetch(`/api/concejal/buscar/${encodeURIComponent(cedula)}`);
  },

  concejalAgregar(cedula, { caudillo, telefono, direccion } = {}) {
    return this._fetch('/api/concejal/agregar', {
      method: 'POST',
      body: JSON.stringify({ cedula, caudillo, telefono, direccion }),
    });
  },

  concejalEditarContacto(cedula, { telefono, direccion }) {
    return this._fetch(`/api/concejal/contacto/${encodeURIComponent(cedula)}`, {
      method: 'PATCH',
      body: JSON.stringify({ telefono, direccion }),
    });
  },

  concejalEliminar(cedula) {
    return this._fetch(`/api/concejal/eliminar/${encodeURIComponent(cedula)}`, { method: 'DELETE' });
  },

  adminListarConcejales() {
    return this._fetch('/api/dashboard/admin/concejales');
  },

  adminListaConcejal(nombreConcejal) {
    return this._fetch(`/api/dashboard/admin/lista?concejal=${encodeURIComponent(nombreConcejal)}`);
  },

  adminEliminarDeLista(nombreConcejal, cedula) {
    const qs = `concejal=${encodeURIComponent(nombreConcejal)}&cedula=${encodeURIComponent(cedula)}`;
    return this._fetch(`/api/dashboard/admin/lista?${qs}`, { method: 'DELETE' });
  },
};

window.Api = Api;
