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

      <div style="display:flex; gap:8px; margin-bottom:12px;">
        <button type="button" id="btn-ver-por-mesa" class="secundario" style="flex:1;">
          📊 Ver avance por mesa
        </button>
        <button type="button" id="btn-pdf" class="secundario" style="flex:1;">
          📄 Generar PDF
        </button>
      </div>
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

  let ultimosDatos = null;

  document.getElementById('btn-pdf').addEventListener('click', () => {
    if (!ultimosDatos) return;
    generarPDFLista(ultimosDatos, perfil);
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
      const resp = await window.Api.concejalEliminar(cedula);
      if (!resp.ok) {
        alert(resp.datos?.error || 'No se pudo eliminar.');
      }
      await cargar();
      return;
    }

    const btnVoto = e.target.closest('.btn-registrar');
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
    ultimosDatos = datos;

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
        <span class="acciones-fila">
          ${
            v.estadoGestion === 'REGISTRADO'
              ? ''
              : `<button class="btn-registrar" data-cedula="${v.cedula}">Registrar</button>
                 <button class="btn-eliminar" data-cedula="${v.cedula}">Eliminar</button>`
          }
        </span>
      </div>`
      )
      .join('');
  }

  await cargar();
  setInterval(cargar, 15000); // actualizacion en vivo cada 15s mientras haya señal
}

/**
 * Abre una pestaña con la lista en formato imprimible y dispara el dialogo
 * de impresion del navegador (desde ahi se puede elegir "Guardar como PDF").
 * No usa ninguna libreria externa: es la forma mas simple y confiable de
 * generar un PDF que funcione tambien offline, sin depender del servidor.
 */
function generarPDFLista(datos, perfil) {
  const votantes = [...datos.votantes].sort((a, b) => {
    const localA = a.local || '', localB = b.local || '';
    if (localA !== localB) return localA.localeCompare(localB);
    if ((a.mesa || 0) !== (b.mesa || 0)) return (a.mesa || 0) - (b.mesa || 0);
    return (a.nombresApellidos || '').localeCompare(b.nombresApellidos || '');
  });

  const totalDuplicados = votantes.filter((v) => v.duplicado).length;
  const generadoEl = window.formatearFechaPY ? window.formatearFechaPY(new Date().toISOString()) : new Date().toLocaleString();

  const filas = votantes
    .map(
      (v, i) => `
    <tr class="${v.duplicado ? 'duplicado' : ''}">
      <td>${i + 1}</td>
      <td>${v.cedula}</td>
      <td>${v.nombresApellidos || ''}</td>
      <td>${v.local || '-'}</td>
      <td>${v.mesa ?? '-'}</td>
      <td>${v.caudillo || '-'}</td>
      <td>${v.estadoGestion === 'REGISTRADO' ? 'Registrado' : 'Pendiente'}</td>
      <td>${v.duplicado ? '⚠ DUPLICADO' : ''}</td>
    </tr>`
    )
    .join('');

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <title>Lista de votantes - ${perfil.nombreConcejal}</title>
      <style>
        body { font-family: Arial, sans-serif; color: #111; padding: 24px; }
        h1 { font-size: 1.3rem; margin-bottom: 4px; }
        .sub { color: #555; font-size: 0.85rem; margin-bottom: 16px; }
        .resumen { display: flex; gap: 24px; margin-bottom: 16px; font-size: 0.9rem; }
        .resumen strong { display: block; font-size: 1.2rem; }
        table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
        th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
        th { background: #f1f1f1; }
        tr.duplicado { background: #fef9c3; }
        tr.duplicado td:last-child { color: #92400e; font-weight: 700; }
        @media print {
          body { padding: 0; }
          button { display: none; }
        }
      </style>
    </head>
    <body>
      <h1>Lista de votantes — ${perfil.nombreConcejal}</h1>
      <p class="sub">Generado el ${generadoEl}</p>
      <div class="resumen">
        <span>Total asignado <strong>${datos.totalAsignado}</strong></span>
        <span>Registrados <strong>${datos.totalRegistrado}</strong></span>
        <span>Pendientes <strong>${datos.totalPendiente}</strong></span>
        <span>Duplicados <strong>${totalDuplicados}</strong></span>
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th><th>Cédula</th><th>Nombre</th><th>Local</th><th>Mesa</th><th>Caudillo</th><th>Estado</th><th>Duplicado</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
      <script>window.onload = () => window.print();</script>
    </body>
    </html>
  `;

  const ventana = window.open('', '_blank');
  if (!ventana) {
    alert('El navegador bloqueó la ventana de impresión. Permití las ventanas emergentes para este sitio e intentá de nuevo.');
    return;
  }
  ventana.document.open();
  ventana.document.write(html);
  ventana.document.close();
}

window.renderConcejal = renderConcejal;
