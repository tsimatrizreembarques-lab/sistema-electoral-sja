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

      <button type="button" id="btn-ver-por-mesa" class="secundario" style="width:100%; margin-bottom:12px;">
        📊 Ver avance por mesa
      </button>
      <div id="por-mesa" class="oculto"></div>

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

  document.getElementById('btn-ver-por-mesa').addEventListener('click', () => {
    const panel = document.getElementById('por-mesa');
    const oculto = panel.classList.toggle('oculto');
    document.getElementById('btn-ver-por-mesa').textContent = oculto ? '📊 Ver avance por mesa' : '📊 Ocultar avance por mesa';
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
    const btnEliminar = e.target.closest('.btn-eliminar');
    if (btnEliminar) {
      const cedula = btnEliminar.dataset.cedula;
      if (!confirm('¿Eliminar a esta persona de tu lista?')) return;
      await window.Api.concejalEliminar(cedula);
      await cargar();
      return;
    }

    const btnVoto = e.target.closest('.btn-ya-voto');
    if (btnVoto) {
      const cedula = btnVoto.dataset.cedula;
      if (!confirm('¿Confirmás que esta persona ya pasó por comando o mesa? Se va a sumar al conteo oficial.')) return;
      btnVoto.disabled = true;
      const resp = await window.Api.registrarVotante({ cedula, dispositivoId: `concejal-${perfil.usuario}` });
      if (!resp.ok) {
        alert(resp.datos?.mensaje || resp.datos?.error || 'No se pudo confirmar.');
        btnVoto.disabled = false;
        return;
      }
      await cargar();
    }
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

    const entradasPorMesa = Object.entries(datos.porMesa || {}).sort((a, b) => b[1].total - a[1].total);
    document.getElementById('por-mesa').innerHTML = entradasPorMesa.length === 0
      ? '<p class="sub">Sin datos aún.</p>'
      : `<div class="tabla-simple">${entradasPorMesa
          .map(([clave, c]) => `<div class="fila"><span>${clave}</span><strong>${c.registrados}/${c.total}</strong></div>`)
          .join('')}</div>`;

    document.getElementById('lista').innerHTML = datos.votantes
      .map(
        (v) => `
      <div class="fila-votante ${v.estadoGestion === 'REGISTRADO' ? 'ok' : ''} ${v.duplicado ? 'duplicado' : ''}">
        <span class="icono-estado">${v.estadoGestion === 'REGISTRADO' ? '✓' : '○'}</span>
        <span class="nombre-votante">
          ${v.nombresApellidos}
          <span class="sub"> · CI: ${v.cedula}</span>
          ${v.local ? `<span class="sub"> · ${v.local}${v.mesa ? ` — Mesa ${v.mesa}` : ''}</span>` : ''}
          ${v.caudillo ? `<span class="sub"> · Caudillo: ${v.caudillo}</span>` : ''}
          ${v.duplicado ? `<span class="advertencia-duplicado">⚠ Duplicado en otra lista</span>` : ''}
        </span>
        <span class="estado">${
          v.estadoGestion === 'REGISTRADO'
            ? `Registrado (${v.origenRegistro || ''})`
            : 'Pendiente'
        }</span>
        ${
          v.estadoGestion === 'REGISTRADO'
            ? ''
            : `<button class="btn-ya-voto link" data-cedula="${v.cedula}">Ya votó</button>`
        }
        <button class="btn-eliminar link" data-cedula="${v.cedula}">Eliminar</button>
      </div>`
      )
      .join('');
  }

  await cargar();
  setInterval(cargar, 15000); // actualizacion en vivo cada 15s mientras haya señal
}

window.renderConcejal = renderConcejal;
