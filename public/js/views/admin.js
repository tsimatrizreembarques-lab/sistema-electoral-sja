async function renderAdmin(root, perfil) {
  const esc = window.escaparHTML;

  root.innerHTML = `
    <header class="encabezado">
      <div><strong>Dashboard Administrador</strong></div>
      <button id="btn-salir" class="link">Salir</button>
    </header>
    <main class="contenido">
      <div id="totales" class="grid-totales"></div>
      <button type="button" id="btn-pdf-listas" class="secundario" style="width:100%; margin-bottom:8px;">
        📄 Generar PDF de listas de concejales
      </button>
      <button type="button" id="btn-pdf-duplicados" class="secundario" style="width:100%; margin-bottom:16px;">
        ⚠ Generar reporte de duplicados
      </button>
      <h3>Por escuela</h3>
      <div id="por-escuela"></div>
      <h3>Por concejal</h3>
      <div id="por-concejal"></div>

      <h3>Gestionar listas de concejales</h3>
      <div class="tarjeta">
        <select id="select-lista-concejal" class="selector">
          <option value="">Elegí un concejal…</option>
        </select>
        <input id="filtro-lista" type="text" placeholder="Filtrar por nombre o cédula" class="oculto" />
        <p id="resumen-lista" class="sub"></p>
      </div>
      <div id="lista-concejal-admin"></div>
    </main>
  `;

  document.getElementById('btn-salir').addEventListener('click', () => window.App.salir());

  document.getElementById('btn-pdf-listas').addEventListener('click', async () => {
    const btn = document.getElementById('btn-pdf-listas');
    btn.disabled = true;
    btn.textContent = 'Generando...';
    const { ok, datos } = await window.Api.dashboardAdminListas();
    btn.disabled = false;
    btn.textContent = '📄 Generar PDF de listas de concejales';
    if (!ok) {
      window.Notificaciones.mostrarModal('No se pudo generar', datos?.error || 'No se pudo generar el reporte.');
      return;
    }
    generarPDFListasConcejales(datos);
  });

  document.getElementById('btn-pdf-duplicados').addEventListener('click', async () => {
    const btn = document.getElementById('btn-pdf-duplicados');
    btn.disabled = true;
    btn.textContent = 'Generando...';
    const { ok, datos } = await window.Api.dashboardAdminDuplicados();
    btn.disabled = false;
    btn.textContent = '⚠ Generar reporte de duplicados';
    if (!ok) {
      window.Notificaciones.mostrarModal('No se pudo generar', datos?.error || 'No se pudo generar el reporte.');
      return;
    }
    generarPDFDuplicados(datos);
  });

  function tabla(objeto) {
    const entradas = Object.entries(objeto).sort((a, b) => b[1] - a[1]);
    if (entradas.length === 0) return '<p class="sub">Sin datos aún.</p>';
    return `<div class="tabla-simple">${entradas
      .map(([k, v]) => `<div class="fila"><span>${esc(k)}</span><strong>${v}</strong></div>`)
      .join('')}</div>`;
  }

  // Una tarjeta por escuela, con su total arriba y sus mesas (en orden numerico) debajo.
  function tablaPorEscuela(porLocal) {
    const entradas = Object.entries(porLocal).sort((a, b) => a[0].localeCompare(b[0]));
    if (entradas.length === 0) return '<p class="sub">Sin datos aún.</p>';
    return entradas
      .map(
        ([local, datos]) => `
      <div class="tarjeta">
        <h4 style="margin:0 0 8px;">${esc(local)} <span class="sub">— ${datos.registrados}/${datos.total}</span></h4>
        <div class="tabla-simple">
          ${datos.mesas
            .map((m) => `<div class="fila"><span>Mesa ${esc(m.mesa ?? '-')}</span><strong>${m.registrados}/${m.total}</strong></div>`)
            .join('')}
        </div>
      </div>`
      )
      .join('');
  }

  async function cargar() {
    const { ok, datos } = await window.Api.dashboardAdmin();
    if (!ok || !document.getElementById('totales')) return;

    document.getElementById('totales').innerHTML = `
      <div class="tarjeta"><span class="num">${datos.totalPadron}</span><span>Padrón total</span></div>
      <div class="tarjeta ok"><span class="num">${datos.totalRegistrados}</span><span>Registrados</span></div>
      <div class="tarjeta"><span class="num">${datos.totalPendientes}</span><span>Pendientes</span></div>
      <div class="tarjeta ${datos.duplicadosEntreListas > 0 ? 'alerta' : ''}">
        <span class="num">${datos.duplicadosEntreListas}</span><span>Duplicados entre listas</span>
      </div>
    `;

    document.getElementById('por-escuela').innerHTML = tablaPorEscuela(datos.porLocal);
    document.getElementById('por-concejal').innerHTML = tabla(datos.porConcejal);
  }

  // --- Gestion de listas: el admin elige un concejal, ve su lista y puede
  // quitar a cualquier persona (el concejal solo puede quitar pendientes). ---
  let listaActual = null;

  async function cargarSelectorConcejales() {
    const { ok, datos } = await window.Api.adminListarConcejales();
    const select = document.getElementById('select-lista-concejal');
    if (!ok || !select) return;
    select.innerHTML = '<option value="">Elegí un concejal…</option>' + datos.concejales
      .map((c) => `<option value="${esc(c.nombreConcejal)}">${c.opcion ? `Opción ${esc(c.opcion)} — ` : ''}${esc(c.nombreConcejal)}${c.lista ? ` (Lista ${esc(c.lista)})` : ''}</option>`)
      .join('');
  }

  async function cargarListaConcejal(nombreConcejal) {
    const cont = document.getElementById('lista-concejal-admin');
    const filtro = document.getElementById('filtro-lista');
    const resumen = document.getElementById('resumen-lista');
    listaActual = null;
    cont.innerHTML = '';
    resumen.textContent = '';
    filtro.classList.add('oculto');
    if (!nombreConcejal) return;

    resumen.textContent = 'Cargando…';
    const { ok, datos } = await window.Api.adminListaConcejal(nombreConcejal);
    if (document.getElementById('select-lista-concejal')?.value !== nombreConcejal) return; // cambio de seleccion mientras cargaba
    if (!ok) {
      resumen.textContent = datos?.error || 'No se pudo cargar la lista.';
      return;
    }
    listaActual = datos;
    filtro.classList.remove('oculto');
    pintarListaConcejal();
  }

  function pintarListaConcejal() {
    if (!listaActual) return;
    const texto = document.getElementById('filtro-lista').value.trim().toUpperCase();
    const visibles = listaActual.lista.filter(
      (v) => !texto || v.cedula.includes(texto) || (v.nombresApellidos || '').toUpperCase().includes(texto)
    );
    const registrados = listaActual.lista.filter((v) => v.estadoGestion === 'REGISTRADO').length;
    const duplicados = listaActual.lista.filter((v) => v.duplicado).length;
    document.getElementById('resumen-lista').textContent =
      `${listaActual.total} en la lista · ${registrados} registrados · ${duplicados} duplicados con otra lista`;

    document.getElementById('lista-concejal-admin').innerHTML = visibles.length === 0
      ? '<p class="sub">Sin personas en esta lista.</p>'
      : visibles
          .map((v) => {
            const registrado = v.estadoGestion === 'REGISTRADO';
            const wa = window.enlaceWhatsApp(v.telefono);
            return `
        <div class="fila-votante ${registrado ? 'ok' : ''}">
          <span class="icono-estado">${registrado ? '✓' : '○'}</span>
          <span class="nombre-votante">
            ${esc(v.nombresApellidos)}
            <span class="sub"> · CI: ${esc(v.cedula)}</span>
            ${v.local ? `<span class="sub"> · ${esc(v.local)}${v.mesa ? ` — Mesa ${esc(v.mesa)}` : ''}</span>` : ''}
            ${v.caudillo ? `<span class="sub"> · Caudillo: ${esc(v.caudillo)}</span>` : ''}
            ${v.duplicado ? '<span class="etiqueta-duplicado"> · ⚠ También en otra lista</span>' : ''}
            ${v.direccion ? `<span class="sub contacto">📍 ${esc(v.direccion)}</span>` : ''}
            ${wa ? `<span class="contacto"><a class="btn-whatsapp" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp ${esc(v.telefono)}</a></span>` : ''}
          </span>
          <span class="estado">${registrado ? 'Registrado' : 'Pendiente'}</span>
          <span class="acciones-fila">
            <button class="btn-eliminar" data-cedula="${esc(v.cedula)}">Eliminar</button>
          </span>
        </div>`;
          })
          .join('');
  }

  document.getElementById('select-lista-concejal').addEventListener('change', (e) => {
    document.getElementById('filtro-lista').value = '';
    cargarListaConcejal(e.target.value);
  });
  document.getElementById('filtro-lista').addEventListener('input', pintarListaConcejal);

  document.getElementById('lista-concejal-admin').addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-eliminar');
    if (!btn || !listaActual) return;
    const nombreConcejal = listaActual.nombreConcejal;
    const v = listaActual.lista.find((x) => x.cedula === btn.dataset.cedula);
    if (!v) return;

    const aviso = v.estadoGestion === 'REGISTRADO'
      ? '\n\nYa fue registrado: su registro de asistencia se conserva, solo deja de figurar en esta lista.'
      : '';
    const confirmado = await window.Notificaciones.confirmarModal(
      'Eliminar de la lista',
      `¿Quitar a ${esc(v.nombresApellidos)} (CI ${esc(v.cedula)}) de la lista de ${esc(nombreConcejal)}?${aviso}`,
      'Eliminar'
    );
    if (!confirmado) return;

    btn.disabled = true;
    const resp = await window.Api.adminEliminarDeLista(nombreConcejal, v.cedula);
    if (!resp.ok) {
      btn.disabled = false;
      window.Notificaciones.mostrarModal('No se pudo eliminar', esc(resp.datos?.error || 'No se pudo eliminar.'));
      return;
    }
    await Promise.all([cargarListaConcejal(nombreConcejal), cargar()]);
  });

  await Promise.all([cargar(), cargarSelectorConcejales()]);
  window.App.intervaloDeVista(cargar, 45000); // el dashboard admin lee un unico documento resumen, no hace falta mas seguido
}

/**
 * Abre una pestaña con el listado completo de TODAS las listas de TODOS los
 * concejales, en formato imprimible, y dispara el dialogo de impresion del
 * navegador (desde ahi se puede elegir "Guardar como PDF"). Mismo patron que
 * el PDF individual del concejal, pero con una columna extra de Concejal.
 */
function generarPDFListasConcejales(datos) {
  const esc = window.escaparHTML;
  const generadoEl = window.formatearFechaPY ? window.formatearFechaPY(new Date().toISOString()) : new Date().toLocaleString();

  const filas = datos.lista
    .map(
      (v, i) => `
    <tr class="${v.duplicado ? 'duplicado' : ''}">
      <td>${i + 1}</td>
      <td>${esc(v.opcionConcejal ?? '-')}</td>
      <td>${esc(v.nombreConcejal)}</td>
      <td>${esc(v.lista ?? '-')}</td>
      <td>${esc(v.cedula)}</td>
      <td>${esc(v.nombresApellidos)}</td>
      <td>${esc(v.local || '-')}</td>
      <td>${esc(v.mesa ?? '-')}</td>
      <td>${esc(v.caudillo || '-')}</td>
      <td>${esc(v.telefono || '-')}</td>
      <td>${esc(v.direccion || '-')}</td>
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
      <title>Listas de concejales - Control Electoral SJA</title>
      <style>
        body { font-family: Arial, sans-serif; color: #111; padding: 24px; }
        h1 { font-size: 1.3rem; margin-bottom: 4px; }
        .sub { color: #555; font-size: 0.85rem; margin-bottom: 16px; }
        .resumen { display: flex; gap: 24px; margin-bottom: 16px; font-size: 0.9rem; }
        .resumen strong { display: block; font-size: 1.2rem; }
        table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
        th, td { border: 1px solid #ccc; padding: 5px 7px; text-align: left; }
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
      <h1>Listas de concejales — Control Electoral SJA</h1>
      <p class="sub">Generado el ${generadoEl}</p>
      <div class="resumen">
        <span>Total de votantes preasignados <strong>${datos.total}</strong></span>
        <span>Cédulas duplicadas entre listas <strong>${datos.duplicados}</strong></span>
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th><th>Opción</th><th>Concejal</th><th>Lista</th><th>Cédula</th><th>Nombre</th><th>Local</th><th>Mesa</th><th>Caudillo</th><th>Teléfono</th><th>Dirección</th><th>Estado</th><th>Duplicado</th>
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
    window.Notificaciones.mostrarModal(
      'Ventana bloqueada',
      'El navegador bloqueó la ventana de impresión. Permití las ventanas emergentes para este sitio e intentá de nuevo.'
    );
    return;
  }
  ventana.document.open();
  ventana.document.write(html);
  ventana.document.close();
}

/**
 * Abre una pestaña con el reporte de cedulas que figuran en 2 o mas listas
 * de concejales — EXCLUSIVO del admin, los concejales nunca ven esto. Una
 * fila por cedula, con todos los concejales que la tienen listados juntos.
 */
function generarPDFDuplicados(datos) {
  const esc = window.escaparHTML;
  const generadoEl = window.formatearFechaPY ? window.formatearFechaPY(new Date().toISOString()) : new Date().toLocaleString();

  const filas = datos.duplicados
    .map(
      (d, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(d.cedula)}</td>
      <td>${esc(d.nombresApellidos)}</td>
      <td>${esc(d.local || '-')}</td>
      <td>${esc(d.mesa ?? '-')}</td>
      <td>${d.estadoGestion === 'REGISTRADO' ? `Registrado (${esc(d.origenRegistro || '')})` : 'Pendiente'}</td>
      <td>${d.cantidadConcejales}</td>
      <td>${d.concejales.map((c) => `${esc(c.nombreConcejal)}${c.caudillo ? ` (caudillo: ${esc(c.caudillo)})` : ''}`).join('<br>')}</td>
    </tr>`
    )
    .join('');

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <title>Reporte de duplicados - Control Electoral SJA</title>
      <style>
        body { font-family: Arial, sans-serif; color: #111; padding: 24px; }
        h1 { font-size: 1.3rem; margin-bottom: 4px; }
        .sub { color: #555; font-size: 0.85rem; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
        th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
        th { background: #f1f1f1; }
        tr:nth-child(even) { background: #fef9c3; }
        @media print {
          body { padding: 0; }
          button { display: none; }
        }
      </style>
    </head>
    <body>
      <h1>Reporte de duplicados — Control Electoral SJA</h1>
      <p class="sub">Generado el ${generadoEl} · Confidencial: uso exclusivo del administrador</p>
      <p><strong>${datos.total}</strong> cédulas figuran en 2 o más listas de concejales.</p>
      <table>
        <thead>
          <tr>
            <th>#</th><th>Cédula</th><th>Nombre</th><th>Local</th><th>Mesa</th><th>Estado</th><th>Cant.</th><th>Concejales</th>
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
    window.Notificaciones.mostrarModal(
      'Ventana bloqueada',
      'El navegador bloqueó la ventana de impresión. Permití las ventanas emergentes para este sitio e intentá de nuevo.'
    );
    return;
  }
  ventana.document.open();
  ventana.document.write(html);
  ventana.document.close();
}

window.renderAdmin = renderAdmin;
