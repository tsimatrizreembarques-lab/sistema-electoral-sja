const Api = {
  async _fetch(path, opciones = {}) {
    const sesion = await window.DBLocal.obtenerSesion();
    const headers = { 'Content-Type': 'application/json', ...(opciones.headers || {}) };
    if (sesion?.token) headers.Authorization = `Bearer ${sesion.token}`;

    const respuesta = await fetch(path, { ...opciones, headers });
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

  dashboardConcejal() {
    return this._fetch('/api/dashboard/concejal');
  },

  concejalBuscar(cedula) {
    return this._fetch(`/api/concejal/buscar/${encodeURIComponent(cedula)}`);
  },

  concejalAgregar(cedula, caudillo) {
    return this._fetch('/api/concejal/agregar', {
      method: 'POST',
      body: JSON.stringify({ cedula, caudillo }),
    });
  },

  concejalEliminar(cedula) {
    return this._fetch(`/api/concejal/eliminar/${encodeURIComponent(cedula)}`, { method: 'DELETE' });
  },
};

window.Api = Api;
