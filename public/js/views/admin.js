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
 * PDF con TODAS las listas de TODOS los concejales (una fila por persona y
 * concejal). Las filas de cedulas duplicadas entre listas van resaltadas.
 */
function generarPDFListasConcejales(datos) {
  return window.PDF.descargar({
    titulo: 'Listas de concejales',
    resumen: [`Total preasignados: ${datos.total}`, `Cédulas duplicadas entre listas: ${datos.duplicados}`],
    horizontal: true,
    pie: 'Confidencial: uso exclusivo del administrador',
    nombreArchivo: 'Listas de concejales',
    secciones: [{
      columnas: ['#', 'Opción', 'Concejal', 'Lista', 'Cédula', 'Nombre', 'Local', 'Mesa', 'Caudillo', 'Teléfono', 'Dirección', 'Estado', 'Duplicado'],
      filas: datos.lista.map((v, i) => [
        i + 1, v.opcionConcejal, v.nombreConcejal, v.lista, v.cedula, v.nombresApellidos, v.local, v.mesa,
        v.caudillo, v.telefono, v.direccion,
        v.estadoGestion === 'REGISTRADO' ? 'Registrado' : 'Pendiente',
        v.duplicado ? 'DUPLICADO' : '',
      ]),
      resaltar: (i) => datos.lista[i].duplicado,
    }],
  });
}

/**
 * PDF de cedulas que figuran en 2 o mas listas. Con un concejal elegido,
 * trae solo las de su lista y muestra con quienes las comparte.
 */
function generarPDFDuplicados(datos) {
  const deUno = Boolean(datos.concejal);
  const caudillo = (c) => (c.caudillo ? ` (caudillo: ${c.caudillo})` : '');

  return window.PDF.descargar({
    titulo: deUno ? `Duplicados de ${datos.concejal}` : 'Reporte de duplicados',
    subtitulo: deUno
      ? 'Cédulas de su lista que también figuran en la lista de otro concejal'
      : 'Cédulas que figuran en 2 o más listas de concejales',
    resumen: [`${datos.total} cédulas duplicadas`],
    horizontal: true,
    pie: 'Confidencial: uso exclusivo del administrador',
    nombreArchivo: deUno ? `Duplicados ${datos.concejal}` : 'Duplicados',
    secciones: [{
      columnas: ['#', 'Cédula', 'Nombre', 'Local', 'Mesa', 'Estado', 'Cant.', deUno ? 'Comparte con' : 'Concejales'],
      filas: datos.duplicados.map((d, i) => [
        i + 1, d.cedula, d.nombresApellidos, d.local, d.mesa,
        d.estadoGestion === 'REGISTRADO' ? `Registrado (${d.origenRegistro || ''})` : 'Pendiente',
        d.cantidadConcejales,
        d.concejales
          .filter((c) => !deUno || c.nombreConcejal !== datos.concejal)
          .map((c) => `${c.nombreConcejal}${caudillo(c)}`)
          .join('\n'),
      ]),
      alinearDerecha: [6],
    }],
  });
}

/**
 * PDF de preasignados por lugar de votacion y mesa, con los filtros que se
 * aplicaron en pantalla (concejal y/o lugar). Una seccion por lugar.
 */
function generarPDFPreasignados(datos) {
  const secciones = [];
  for (const l of datos.lugares) {
    secciones.push({
      titulo: `${l.local} — ${l.total} preasignados · ${l.registrados} registrados`,
      columnas: ['Mesa', 'Preasignados', 'Registrados', 'Pendientes'],
      filas: l.mesas.map((m) => [`Mesa ${m.mesa ?? '-'}`, m.total, m.registrados, m.total - m.registrados]),
      alinearDerecha: [1, 2, 3],
    });
    if (l.concejales.length) {
      secciones.push({
        columnas: ['Concejal', 'Preasignados', 'Registrados', 'Pendientes'],
        filas: l.concejales.map((c) => [c.nombreConcejal, c.total, c.registrados, c.total - c.registrados]),
        alinearDerecha: [1, 2, 3],
      });
    }
  }

  return window.PDF.descargar({
    titulo: 'Preasignados por lugar de votación y mesa',
    subtitulo: `Concejal: ${datos.concejal || 'Todos'} · Lugar de votación: ${datos.local || 'Todos'}`,
    resumen: [
      `Preasignados: ${datos.total}`,
      `Registrados: ${datos.totalRegistrados}`,
      `Pendientes: ${datos.total - datos.totalRegistrados}`,
    ],
    pie: 'Confidencial: uso exclusivo del administrador',
    nombreArchivo: `Preasignados ${datos.concejal || 'todos'}${datos.local ? ` ${datos.local}` : ''}`,
    secciones: secciones.length ? secciones : [{ columnas: ['Sin preasignados para este filtro'], filas: [] }],
  });
}

window.renderAdmin = renderAdmin;
