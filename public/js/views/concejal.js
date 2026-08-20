async function renderConcejal(root, perfil) {
  root.innerHTML = `
    <header class="encabezado">
      <div>
        <strong>${perfil.nombreConcejal}</strong>
        <span class="sub">Mi lista</span>
      </div>
      <button id="btn-salir" class="link">Salir</button>
    </header>
    <main class="contenido">
      <div id="resumen" class="tarjeta"></div>

      <div class="tarjeta">
        <h3>Agregar votante</h3>
        <form id="form-agregar" class="fila-busqueda">
          <input id="cedula-agregar" type="text" inputmode="numeric" placeholder="Número de cédula" autofocus />
          <button type="submit">Buscar</button>
        </form>
        <div id="preview-agregar"></div>
      </div>

      <div id="lista"></div>
    </main>
  `;

  document.getElementById('btn-salir').addEventListener('click', async () => {
    await window.DBLocal.cerrarSesion();
    window.App.irA('login');
  });

  document.getElementById('form-agregar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cedula = document.getElementById('cedula-agregar').value.trim();
    if (!cedula) return;
    await buscarParaAgregar(cedula);
  });

  async function buscarParaAgregar(cedula) {
    const prev = document.getElementById('preview-agregar');
    prev.innerHTML = '<p class="sub">Buscando...</p>';
    const { ok, datos } = await window.Api.concejalBuscar(cedula);
    if (!ok) {
      prev.innerHTML = `<div class="tarjeta alerta">${datos?.error || 'No se pudo buscar.'}</div>`;
      return;
    }
    if (datos.yaEnMiLista) {
      prev.innerHTML = `<div class="tarjeta alerta"><p>${datos.nombresApellidos}</p><p class="sub">Ya está en tu lista.</p></div>`;
      return;
    }
    let aviso = '';
    if (datos.otrosConcejales.length > 0) {
      aviso = `<p class="advertencia">Ya figura en la lista de: ${datos.otrosConcejales.join(', ')}. Se resolverá en el puesto de comando el día de la elección.</p>`;
    }
    prev.innerHTML = `
      <div class="tarjeta">
        <h3>${datos.nombresApellidos}</h3>
        ${aviso}
        <input id="caudillo-agregar" type="text" placeholder="Caudillo (opcional)" />
        <button id="btn-confirmar-agregar" class="primario">Agregar a mi lista</button>
      </div>
    `;
    document.getElementById('btn-confirmar-agregar').addEventListener('click', async () => {
      const caudillo = document.getElementById('caudillo-agregar').value.trim();
      const resp = await window.Api.concejalAgregar(datos.cedula, caudillo);
      if (!resp.ok) {
        prev.innerHTML = `<div class="tarjeta alerta">${resp.datos?.error || 'No se pudo agregar.'}</div>`;
        return;
      }
      prev.innerHTML = '<div class="tarjeta ok">Agregado correctamente.</div>';
      document.getElementById('cedula-agregar').value = '';
      await cargar();
    });
  }

  document.getElementById('lista').addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-eliminar');
    if (!btn) return;
    const cedula = btn.dataset.cedula;
    if (!confirm('¿Eliminar a esta persona de tu lista?')) return;
    await window.Api.concejalEliminar(cedula);
    await cargar();
  });

  async function cargar() {
    const { ok, datos } = await window.Api.dashboardConcejal();
    if (!ok) {
      document.getElementById('resumen').innerHTML = '<p class="alerta">No se pudo cargar (¿hay conexión?).</p>';
      return;
    }

    document.getElementById('resumen').innerHTML = `
      <p>Total asignado: <strong>${datos.totalAsignado}</strong></p>
      <p>Registrados: <strong>${datos.totalRegistrado}</strong> · Pendientes: <strong>${datos.totalPendiente}</strong></p>
    `;

    document.getElementById('lista').innerHTML = datos.votantes
      .map(
        (v) => `
      <div class="fila-votante ${v.estadoGestion === 'REGISTRADO' ? 'ok' : ''}">
        <span class="icono-estado">${v.estadoGestion === 'REGISTRADO' ? '✓' : '○'}</span>
        <span class="nombre-votante">
          ${v.nombresApellidos}
          ${v.caudillo ? `<span class="sub"> · Caudillo: ${v.caudillo}</span>` : ''}
        </span>
        <span class="estado">${
          v.estadoGestion === 'REGISTRADO'
            ? `Registrado (${v.origenRegistro || ''})`
            : 'Pendiente'
        }</span>
        <button class="btn-eliminar link" data-cedula="${v.cedula}">Eliminar</button>
      </div>`
      )
      .join('');
  }

  await cargar();
  setInterval(cargar, 15000); // actualizacion en vivo cada 15s mientras haya señal
}

window.renderConcejal = renderConcejal;
