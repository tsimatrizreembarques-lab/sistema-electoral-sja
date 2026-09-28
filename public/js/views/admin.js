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
      <div style="display:flex; gap:8px; margin-bottom:16px;">
        <select id="select-duplicados-concejal" class="selector" style="flex:1; margin:0;">
          <option value="">Duplicados: todos los concejales</option>
        </select>
        <button type="button" id="btn-pdf-duplicados" class="secundario" style="flex-shrink:0;">
          ⚠ Generar reporte
        </button>
      </div>
      <h3>Por escuela</h3>
      <div id="por-escuela"></div>
      <h3>Por concejal</h3>
      <div id="por-concejal"></div>

      <h3>Preasignados por lugar y mesa</h3>
      <div class="tarjeta">
        <select id="select-pre-concejal" class="selector">
          <option value="">Todos los concejales</option>
        </select>
        <select id="select-pre-local" class="selector">
          <option value="">Todos los lugares de votación</option>
        </select>
        <div style="display:flex; gap:8px;">
          <button type="button" id="btn-ver-preasignados" class="secundario" style="flex:1;">🔍 Ver</button>
          <button type="button" id="btn-pdf-preasignados" class="secundario" style="flex:1;">📄 PDF</button>
        </div>
        <p id="resumen-preasignados" class="sub"></p>
      </div>
      <div id="preasignados-admin"></div>

      <h3>Gestionar listas de concejales</h3>
      <div class="tarjeta">
        <select id="select-lista-concejal" class="selector">
          <option value="">Elegí un concejal…</option>
        </select>
        <input id="filtro-lista" type="text" placeholder="Filtrar por nombre o cédula" class="oculto" />
        <p id="resumen-lista" class="sub"></p>
        <button type="button" id="btn-resetear-password" class="btn-editar oculto" style="width:100%;">
          🔑 Resetear contraseña de este concejal
        </button>
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
    const concejal = document.getElementById('select-duplicados-concejal').value;
    btn.disabled = true;
    btn.textContent = 'Generando...';
    const { ok, datos } = await window.Api.dashboardAdminDuplicados(concejal);
    btn.disabled = false;
    btn.textContent = '⚠ Generar reporte';
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

  // Los tres selectores de concejal del admin (gestion de listas, duplicados
  // y preasignados) se llenan con la misma consulta.
  async function cargarSelectorConcejales() {
    const { ok, datos } = await window.Api.adminListarConcejales();
    if (!ok || !document.getElementById('select-lista-concejal')) return;
    const opciones = datos.concejales
      .map((c) => `<option value="${esc(c.nombreConcejal)}">${c.opcion ? `Opción ${esc(c.opcion)} — ` : ''}${esc(c.nombreConcejal)}${c.lista ? ` (Lista ${esc(c.lista)})` : ''}</option>`)
      .join('');
    document.getElementById('select-lista-concejal').innerHTML = '<option value="">Elegí un concejal…</option>' + opciones;
    document.getElementById('select-duplicados-concejal').innerHTML = '<option value="">Duplicados: todos los concejales</option>' + opciones;
    document.getElementById('select-pre-concejal').innerHTML = '<option value="">Todos los concejales</option>' + opciones;
  }

  // --- Preasignados por lugar de votacion y mesa ---
  async function cargarPreasignados() {
    const btn = document.getElementById('btn-ver-preasignados');
    const resumen = document.getElementById('resumen-preasignados');
    const concejal = document.getElementById('select-pre-concejal').value;
    const local = document.getElementById('select-pre-local').value;

    btn.disabled = true;
    resumen.textContent = 'Cargando…';
    const { ok, datos } = await window.Api.adminPreasignados({ concejal, local });
    btn.disabled = false;
    if (!document.getElementById('preasignados-admin')) return;
    if (!ok) {
      resumen.textContent = datos?.error || 'No se pudo cargar.';
      return null;
    }

    // El selector de lugar se arma con los lugares que existen para ese
    // concejal, conservando la eleccion actual.
    const selLocal = document.getElementById('select-pre-local');
    selLocal.innerHTML = '<option value="">Todos los lugares de votación</option>' + datos.localesDisponibles
      .map((l) => `<option value="${esc(l)}" ${l === local ? 'selected' : ''}>${esc(l)}</option>`)
      .join('');

    resumen.textContent =
      `${datos.total} preasignados · ${datos.totalRegistrados} ya registrados · ${datos.total - datos.totalRegistrados} pendientes`;

    document.getElementById('preasignados-admin').innerHTML = datos.lugares.length === 0
      ? '<p class="sub">Sin preasignados para este filtro.</p>'
      : datos.lugares
          .map((l) => `
        <div class="tarjeta">
          <h4 style="margin:0 0 8px;">${esc(l.local)} <span class="sub">— ${l.total} preasignados · ${l.registrados} registrados</span></h4>
          <div class="tabla-simple">
            ${l.mesas
              .map((m) => `<div class="fila"><span>Mesa ${esc(m.mesa ?? '-')}</span><strong>${m.total} <span class="sub">(${m.registrados} reg.)</span></strong></div>`)
              .join('')}
          </div>
          ${l.concejales.length
            ? `<p class="sub" style="margin:10px 0 4px;">Por concejal</p>
               <div class="tabla-simple">
                 ${l.concejales
                   .map((c) => `<div class="fila"><span>${esc(c.nombreConcejal)}</span><strong>${c.total} <span class="sub">(${c.registrados} reg.)</span></strong></div>`)
                   .join('')}
               </div>`
            : ''}
        </div>`)
          .join('');
    return datos;
  }

  document.getElementById('btn-ver-preasignados').addEventListener('click', cargarPreasignados);
  document.getElementById('select-pre-concejal').addEventListener('change', () => {
    // Al cambiar de concejal, el lugar elegido puede no existir para el nuevo: se vuelve a "Todos".
    document.getElementById('select-pre-local').value = '';
    cargarPreasignados();
  });
  document.getElementById('select-pre-local').addEventListener('change', cargarPreasignados);

  document.getElementById('btn-pdf-preasignados').addEventListener('click', async () => {
    // Siempre con datos frescos y con los filtros que estan elegidos ahora.
    const datos = await cargarPreasignados();
    if (datos) generarPDFPreasignados(datos);
  });

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
    document.getElementById('btn-resetear-password').classList.toggle('oculto', !e.target.value);
    cargarListaConcejal(e.target.value);
  });

  // El admin le asigna al concejal una contraseña nueva generada al azar
  // (ej. si se la olvido) y se la muestra una sola vez para que se la pase.
  document.getElementById('btn-resetear-password').addEventListener('click', async (e) => {
    const btn = e.currentTarget; // despues de un await, e.currentTarget ya es null
    const nombreConcejal = document.getElementById('select-lista-concejal').value;
    if (!nombreConcejal) return;
    const confirmado = await window.Notificaciones.confirmarModal(
      'Resetear contraseña',
      `¿Asignarle una contraseña nueva a ${esc(nombreConcejal)}?\n\nLa actual deja de funcionar en cuanto confirmes.`,
      'Resetear'
    );
    if (!confirmado) return;

    btn.disabled = true;
    const resp = await window.Api.adminResetearPassword(nombreConcejal);
    btn.disabled = false;
    if (!resp.ok) {
      window.Notificaciones.mostrarModal('No se pudo resetear', esc(resp.datos?.error || 'No se pudo resetear la contraseña.'));
      return;
    }
    window.Notificaciones.mostrarModal(
      'Contraseña nueva',
      `Usuario: <strong>${esc(resp.datos.usuario)}</strong>\nContraseña: <strong style="font-size:1.3rem; letter-spacing:1px;">${esc(resp.datos.password)}</strong>\n\n` +
        'Anotala y pasásela al concejal: no se vuelve a mostrar. Después la puede cambiar desde su botón 🔑.'
    );
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
      <td>${d.concejales
        .map((c) => {
          const texto = `${esc(c.nombreConcejal)}${c.caudillo ? ` (caudillo: ${esc(c.caudillo)})` : ''}`;
          // En el reporte de UN concejal, se resalta a ese y se ve con quienes comparte.
          return datos.concejal && c.nombreConcejal === datos.concejal ? `<strong>${texto}</strong>` : texto;
        })
        .join('<br>')}</td>
    </tr>`
    )
    .join('');

  const titulo = datos.concejal ? `Duplicados de ${esc(datos.concejal)}` : 'Reporte de duplicados';
  const descripcion = datos.concejal
    ? `cédulas de la lista de <strong>${esc(datos.concejal)}</strong> figuran también en la lista de otro concejal.`
    : 'cédulas figuran en 2 o más listas de concejales.';

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <title>${titulo} - Control Electoral SJA</title>
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
      <h1>${titulo} — Control Electoral SJA</h1>
      <p class="sub">Generado el ${generadoEl} · Confidencial: uso exclusivo del administrador</p>
      <p><strong>${datos.total}</strong> ${descripcion}</p>
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

/**
 * PDF de preasignados por lugar de votacion y mesa, con los filtros que se
 * aplicaron en pantalla (concejal y/o lugar).
 */
function generarPDFPreasignados(datos) {
  const esc = window.escaparHTML;
  const generadoEl = window.formatearFechaPY ? window.formatearFechaPY(new Date().toISOString()) : new Date().toLocaleString();

  const filtros = [
    `Concejal: <strong>${datos.concejal ? esc(datos.concejal) : 'Todos'}</strong>`,
    `Lugar de votación: <strong>${datos.local ? esc(datos.local) : 'Todos'}</strong>`,
  ].join(' · ');

  const bloques = datos.lugares
    .map((l) => {
      const filasMesas = l.mesas
        .map((m) => `<tr><td>Mesa ${esc(m.mesa ?? '-')}</td><td>${m.total}</td><td>${m.registrados}</td><td>${m.total - m.registrados}</td></tr>`)
        .join('');
      const tablaConcejales = l.concejales.length
        ? `<table class="chica">
            <thead><tr><th>Concejal</th><th>Preasignados</th><th>Registrados</th><th>Pendientes</th></tr></thead>
            <tbody>${l.concejales
              .map((c) => `<tr><td>${esc(c.nombreConcejal)}</td><td>${c.total}</td><td>${c.registrados}</td><td>${c.total - c.registrados}</td></tr>`)
              .join('')}</tbody>
          </table>`
        : '';
      return `
        <h2>${esc(l.local)} <span class="sub">— ${l.total} preasignados · ${l.registrados} registrados</span></h2>
        <table>
          <thead><tr><th>Mesa</th><th>Preasignados</th><th>Registrados</th><th>Pendientes</th></tr></thead>
          <tbody>${filasMesas}</tbody>
        </table>
        ${tablaConcejales}`;
    })
    .join('');

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <title>Preasignados por lugar y mesa - Control Electoral SJA</title>
      <style>
        body { font-family: Arial, sans-serif; color: #111; padding: 24px; }
        h1 { font-size: 1.3rem; margin-bottom: 4px; }
        h2 { font-size: 1rem; margin: 20px 0 6px; }
        .sub { color: #555; font-size: 0.85rem; font-weight: 400; }
        table { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-bottom: 8px; }
        table.chica { width: 70%; }
        th, td { border: 1px solid #ccc; padding: 5px 8px; text-align: left; }
        td:not(:first-child), th:not(:first-child) { text-align: right; }
        th { background: #f1f1f1; }
        h2 { break-after: avoid; }
        @media print { body { padding: 0; } }
      </style>
    </head>
    <body>
      <h1>Preasignados por lugar de votación y mesa — Control Electoral SJA</h1>
      <p class="sub">Generado el ${generadoEl} · ${filtros}</p>
      <p><strong>${datos.total}</strong> preasignados · <strong>${datos.totalRegistrados}</strong> ya registrados · <strong>${datos.total - datos.totalRegistrados}</strong> pendientes</p>
      ${bloques || '<p>Sin preasignados para este filtro.</p>'}
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
