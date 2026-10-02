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
        <button type="button" id="btn-pdf-duplicados-simple" class="secundario" style="flex-shrink:0;">
          ⚠ Duplicados
        </button>
      </div>
      <h3>Corregir concejal de un registro</h3>
      <div class="tarjeta">
        <form id="form-corregir" style="display:flex; gap:8px; margin:0;">
          <input id="corregir-cedula" type="text" inputmode="numeric" placeholder="Cédula ya registrada" style="flex:1; margin:0;" />
          <button type="submit" class="secundario" style="flex-shrink:0;">🔍 Buscar</button>
        </form>
        <div id="corregir-resultado"></div>
      </div>

      <h3>Por escuela</h3>
      <div id="por-escuela"></div>
      <h3>Por concejal</h3>
      <div id="por-concejal"></div>

      <h3>Reporte por concejal</h3>
      <div class="tarjeta">
        <select id="select-rep-concejal" class="selector">
          <option value="">Todos los concejales (comparativo)</option>
        </select>
        <div style="display:flex; gap:8px;">
          <button type="button" id="btn-ver-rep-concejal" class="secundario" style="flex:1;">🔍 Ver</button>
          <button type="button" id="btn-pdf-rep-concejal" class="secundario" style="flex:1;">📄 PDF</button>
        </div>
        <p id="resumen-rep-concejal" class="sub"></p>
      </div>
      <div id="rep-concejal-admin"></div>

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

  // Dos botones con el mismo reporte: el completo, y uno sin la columna de
  // con quien se comparte cada cedula ("Comparte con" / "Concejales").
  function botonPDFDuplicados(id, texto, opciones) {
    const btn = document.getElementById(id);
    btn.addEventListener('click', async () => {
      const concejal = document.getElementById('select-duplicados-concejal').value;
      btn.disabled = true;
      btn.textContent = 'Generando...';
      const { ok, datos } = await window.Api.dashboardAdminDuplicados(concejal);
      btn.disabled = false;
      btn.textContent = texto;
      if (!ok) {
        window.Notificaciones.mostrarModal('No se pudo generar', datos?.error || 'No se pudo generar el reporte.');
        return;
      }
      generarPDFDuplicados(datos, opciones);
    });
  }
  botonPDFDuplicados('btn-pdf-duplicados', '⚠ Generar reporte', {});
  botonPDFDuplicados('btn-pdf-duplicados-simple', '⚠ Duplicados', { sinConcejales: true });

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
  let concejalesAdmin = [];

  async function cargarSelectorConcejales() {
    const { ok, datos } = await window.Api.adminListarConcejales();
    if (!ok || !document.getElementById('select-lista-concejal')) return;
    concejalesAdmin = datos.concejales;
    const opciones = datos.concejales
      .map((c) => `<option value="${esc(c.nombreConcejal)}">${c.opcion ? `Opción ${esc(c.opcion)} — ` : ''}${esc(c.nombreConcejal)}${c.lista ? ` (Lista ${esc(c.lista)})` : ''}</option>`)
      .join('');
    document.getElementById('select-lista-concejal').innerHTML = '<option value="">Elegí un concejal…</option>' + opciones;
    document.getElementById('select-duplicados-concejal').innerHTML = '<option value="">Duplicados: todos los concejales</option>' + opciones;
    document.getElementById('select-pre-concejal').innerHTML = '<option value="">Todos los concejales</option>' + opciones;
    document.getElementById('select-rep-concejal').innerHTML = '<option value="">Todos los concejales (comparativo)</option>' + opciones;
  }

  // --- Corregir concejal: el admin busca una cedula YA registrada y cambia a
  // que concejal quedo asignada (queda anotado en el historial). ---
  const contCorregir = document.getElementById('corregir-resultado');

  document.getElementById('form-corregir').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cedula = window.normalizarCedula(document.getElementById('corregir-cedula').value);
    if (!cedula) return;
    contCorregir.innerHTML = '<p class="sub">Buscando...</p>';
    const { ok, datos } = await window.Api.buscarVotante(cedula);
    if (!ok) {
      contCorregir.innerHTML = `<p class="alerta">${esc(datos?.error || 'No se encontró la cédula.')}</p>`;
      return;
    }
    mostrarCorreccion(datos);
  });

  function mostrarCorreccion(votante) {
    const r = votante.registroActual;
    if (r?.estadoGestion !== 'REGISTRADO') {
      contCorregir.innerHTML = `<p class="sub">${esc(votante.nombresApellidos)} todavía no fue registrado: no hay nada que corregir.</p>`;
      return;
    }
    const actual = r.concejalAsignado || '';
    const enSusListas = new Set(votante.preasignados.map((p) => p.nombreConcejal));
    const opcion = (c) =>
      `<option value="${esc(c.nombreConcejal)}" ${c.nombreConcejal === actual ? 'selected' : ''}>${c.opcion ? `Opción ${esc(c.opcion)} — ` : ''}${esc(c.nombreConcejal)}${c.lista ? ` (Lista ${esc(c.lista)})` : ''}</option>`;
    const deSusListas = concejalesAdmin.filter((c) => enSusListas.has(c.nombreConcejal));
    const otros = concejalesAdmin.filter((c) => !enSusListas.has(c.nombreConcejal));

    contCorregir.innerHTML = `
      <p style="margin-top:12px;"><strong>${esc(votante.nombresApellidos)}</strong> · CI ${esc(votante.cedula)} · ${esc(votante.local)} — Mesa ${esc(votante.mesa)}</p>
      <p class="sub">${esc(r.origenRegistro || '')}</p>
      <p>Figura en: <strong>${votante.preasignados.length ? votante.preasignados.map((p) => esc(p.nombreConcejal)).join(', ') : 'ninguna lista'}</strong></p>
      <p>Asignado ahora: <strong>${esc(actual || 'Sin concejal')}</strong></p>
      <select id="corregir-select" class="selector">
        <option value="" ${actual ? '' : 'selected'}>Sin concejal</option>
        ${deSusListas.length ? `<optgroup label="En cuya lista figura">${deSusListas.map(opcion).join('')}</optgroup>` : ''}
        <optgroup label="${deSusListas.length ? 'Otros concejales' : 'Concejales'}">${otros.map(opcion).join('')}</optgroup>
      </select>
      <button type="button" id="btn-corregir-guardar" class="primario" style="width:100%;">Guardar cambio</button>
    `;

    document.getElementById('btn-corregir-guardar').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const nuevo = document.getElementById('corregir-select').value || null;
      if ((nuevo || '') === actual) {
        window.Notificaciones.mostrarModal('Sin cambios', 'Ya está asignado a ese concejal.');
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Guardando...';
      const { ok, datos } = await window.Api.adminCorregirConcejal(votante.cedula, nuevo);
      if (!ok) {
        btn.disabled = false;
        btn.textContent = 'Guardar cambio';
        window.Notificaciones.mostrarModal('No se pudo guardar', datos?.error || 'No se pudo corregir el concejal.');
        return;
      }
      contCorregir.innerHTML = `<p class="ok" style="margin-top:12px;">Listo: ${esc(votante.nombresApellidos)} pasó de <strong>${esc(datos.concejalAnterior || 'Sin concejal')}</strong> a <strong>${esc(datos.concejalAsignado || 'Sin concejal')}</strong>.</p>`;
      document.getElementById('corregir-cedula').value = '';
    });
  }

  // --- Reporte por concejal: comparativo de todos, o la ficha de uno ---
  const porcentaje = (parte, total) => (total ? `${Math.round((parte / total) * 100)}%` : '-');

  async function cargarReporteConcejales() {
    const btn = document.getElementById('btn-ver-rep-concejal');
    const resumen = document.getElementById('resumen-rep-concejal');
    const concejal = document.getElementById('select-rep-concejal').value;

    btn.disabled = true;
    resumen.textContent = 'Cargando…';
    const { ok, datos } = await window.Api.adminReporteConcejales(concejal);
    btn.disabled = false;
    const cont = document.getElementById('rep-concejal-admin');
    if (!cont) return null;
    if (!ok) {
      resumen.textContent = datos?.error || 'No se pudo cargar.';
      return null;
    }

    const tot = datos.concejales.reduce(
      (a, c) => ({ pre: a.pre + c.preasignados, reg: a.reg + c.registrados }), { pre: 0, reg: 0 }
    );

    if (!datos.concejal) {
      resumen.textContent = `${datos.concejales.length} concejales · ${tot.pre} preasignados · ${tot.reg} registrados (${porcentaje(tot.reg, tot.pre)})`;
      cont.innerHTML = datos.concejales
        .map((c) => `
        <div class="tarjeta">
          <h4 style="margin:0 0 6px;">${c.opcion ? `Opción ${esc(c.opcion)} — ` : ''}${esc(c.nombreConcejal)}</h4>
          <div class="tabla-simple">
            <div class="fila"><span>Preasignados</span><strong>${c.preasignados}</strong></div>
            <div class="fila"><span>Registrados</span><strong>${c.registrados} <span class="sub">(${porcentaje(c.registrados, c.preasignados)})</span></strong></div>
            <div class="fila"><span>Votaron con otra lista</span><strong>${c.otraLista}</strong></div>
            ${c.sinAsignar ? `<div class="fila"><span>Votaron sin concejal asignado</span><strong>${c.sinAsignar}</strong></div>` : ''}
            <div class="fila"><span>Pendientes</span><strong>${c.pendientes}</strong></div>
            <div class="fila"><span>Duplicados con otras listas</span><strong>${c.duplicados}</strong></div>
            <div class="fila"><span>Asignados en Comando</span><strong>${c.asignadosEnComando}</strong></div>
          </div>
          ${c.lugares.length
            ? `<p class="sub" style="margin:10px 0 4px;">Por lugar de votación</p>
               <div class="tabla-simple">${c.lugares
                 .map((l) => `<div class="fila"><span>${esc(l.local)}</span><strong>${l.preasignados} <span class="sub">(${l.registrados} reg.)</span></strong></div>`)
                 .join('')}</div>`
            : '<p class="sub" style="margin-top:8px;">Todavía no cargó a nadie.</p>'}
        </div>`)
        .join('');
      return datos;
    }

    const c = datos.concejales[0];
    if (!c) {
      resumen.textContent = 'Ese concejal no tiene datos.';
      cont.innerHTML = '';
      return datos;
    }
    resumen.textContent =
      `${c.preasignados} preasignados · ${c.registrados} registrados (${porcentaje(c.registrados, c.preasignados)}) · ` +
      `${c.otraLista} votaron con otra lista${c.sinAsignar ? ` · ${c.sinAsignar} votaron sin asignar` : ''} · ` +
      `${c.pendientes} pendientes · ${c.duplicados} duplicados · ${c.asignadosEnComando} asignados en Comando`;
    cont.innerHTML = c.lugares.length === 0
      ? '<p class="sub">Todavía no cargó a nadie.</p>'
      : c.lugares
          .map((l) => `
        <div class="tarjeta">
          <h4 style="margin:0 0 8px;">${esc(l.local)} <span class="sub">— ${l.preasignados} preasignados · ${l.registrados} registrados</span></h4>
          <div class="tabla-simple">${l.mesas
            .map((m) => `<div class="fila"><span>Mesa ${esc(m.mesa ?? '-')}</span><strong>${m.preasignados} <span class="sub">(${m.registrados} reg.)</span></strong></div>`)
            .join('')}</div>
        </div>`)
          .join('') + '<p class="sub">La lista completa de sus votantes sale en el PDF.</p>';
    return datos;
  }

  document.getElementById('btn-ver-rep-concejal').addEventListener('click', cargarReporteConcejales);
  document.getElementById('select-rep-concejal').addEventListener('change', cargarReporteConcejales);
  document.getElementById('btn-pdf-rep-concejal').addEventListener('click', async () => {
    const datos = await cargarReporteConcejales();
    if (datos) generarPDFReporteConcejales(datos);
  });

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
function generarPDFDuplicados(datos, { sinConcejales = false } = {}) {
  const deUno = Boolean(datos.concejal);
  const caudillo = (c) => (c.caudillo ? ` (caudillo: ${c.caudillo})` : '');
  const columnaConcejales = deUno ? 'Comparte con' : 'Concejales';

  return window.PDF.descargar({
    titulo: deUno ? `Duplicados de ${datos.concejal}` : 'Reporte de duplicados',
    subtitulo: deUno
      ? 'Cédulas de su lista que también figuran en la lista de otro concejal'
      : 'Cédulas que figuran en 2 o más listas de concejales',
    resumen: [`${datos.total} cédulas duplicadas`],
    horizontal: true,
    // La version sin concejales es para poder entregarla: no lleva el pie de
    // confidencial ni la cantidad de listas en que figura cada cedula.
    pie: sinConcejales ? '' : 'Confidencial: uso exclusivo del administrador',
    nombreArchivo: deUno ? `Duplicados ${datos.concejal}` : 'Duplicados',
    secciones: [{
      columnas: ['#', 'Cédula', 'Nombre', 'Local', 'Mesa', 'Estado', ...(sinConcejales ? [] : ['Cant.', columnaConcejales])],
      filas: datos.duplicados.map((d, i) => [
        i + 1, d.cedula, d.nombresApellidos, d.local, d.mesa,
        d.estadoGestion === 'REGISTRADO' ? `Registrado (${d.origenRegistro || ''})` : 'Pendiente',
        ...(sinConcejales ? [] : [
          d.cantidadConcejales,
          d.concejales
            .filter((c) => !deUno || c.nombreConcejal !== datos.concejal)
            .map((c) => `${c.nombreConcejal}${caudillo(c)}`)
            .join('\n'),
        ]),
      ]),
      alinearDerecha: sinConcejales ? [] : [6],
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

/**
 * PDF del reporte por concejal. Todos: tabla comparativa + cuanto tiene cada
 * uno en cada lugar. Uno: su resumen, desglose por lugar/mesa y su lista.
 */
function generarPDFReporteConcejales(datos) {
  const pct = (parte, total) => (total ? `${Math.round((parte / total) * 100)}%` : '-');
  const pie = 'Confidencial: uso exclusivo del administrador';

  if (!datos.concejal) {
    const locales = [...new Set(datos.concejales.flatMap((c) => c.lugares.map((l) => l.local)))].sort();
    const tot = datos.concejales.reduce(
      (a, c) => ({ pre: a.pre + c.preasignados, reg: a.reg + c.registrados }), { pre: 0, reg: 0 }
    );
    return window.PDF.descargar({
      titulo: 'Reporte por concejal',
      subtitulo: 'Comparativo de todos los concejales',
      resumen: [`Concejales: ${datos.concejales.length}`, `Preasignados: ${tot.pre}`, `Registrados: ${tot.reg} (${pct(tot.reg, tot.pre)})`],
      horizontal: true,
      pie,
      nombreArchivo: 'Reporte por concejal',
      secciones: [
        {
          titulo: 'Resumen',
          columnas: ['Opción', 'Concejal', 'Lista', 'Preasignados', 'Registrados', '% avance', 'Con otra lista', 'Sin asignar', 'Pendientes', 'Duplicados', 'Asignados en Comando'],
          filas: datos.concejales.map((c) => [
            c.opcion, c.nombreConcejal, c.lista, c.preasignados, c.registrados, pct(c.registrados, c.preasignados),
            c.otraLista, c.sinAsignar, c.pendientes, c.duplicados, c.asignadosEnComando,
          ]),
          alinearDerecha: [3, 4, 5, 6, 7, 8, 9, 10],
        },
        {
          titulo: 'Preasignados por lugar de votación (registrados entre paréntesis)',
          columnas: ['Concejal', ...locales, 'Total'],
          filas: datos.concejales.map((c) => [
            c.nombreConcejal,
            ...locales.map((loc) => {
              const l = c.lugares.find((x) => x.local === loc);
              return l ? `${l.preasignados} (${l.registrados})` : '0';
            }),
            `${c.preasignados} (${c.registrados})`,
          ]),
          alinearDerecha: locales.map((_, i) => i + 1).concat(locales.length + 1),
        },
      ],
    });
  }

  const c = datos.concejales[0] || { nombreConcejal: datos.concejal, preasignados: 0, registrados: 0, otraLista: 0, sinAsignar: 0, pendientes: 0, duplicados: 0, asignadosEnComando: 0, lugares: [] };
  const secciones = [{
    titulo: 'Por lugar de votación y mesa',
    columnas: ['Lugar de votación', 'Mesa', 'Preasignados', 'Registrados', 'Con otra lista / sin asignar', 'Pendientes'],
    filas: c.lugares.flatMap((l) =>
      l.mesas.map((m) => [l.local, m.mesa, m.preasignados, m.registrados, m.votaronConOtro || 0, m.preasignados - m.registrados - (m.votaronConOtro || 0)])
    ),
    alinearDerecha: [1, 2, 3, 4, 5],
  }];
  if (datos.votantes?.length) {
    secciones.push({
      titulo: 'Lista de votantes',
      columnas: ['#', 'Cédula', 'Nombre', 'Lugar', 'Mesa', 'Caudillo', 'Teléfono', 'Dirección', 'Estado', 'Duplicado'],
      filas: datos.votantes.map((v, i) => [
        i + 1, v.cedula, v.nombresApellidos, v.local, v.mesa, v.caudillo, v.telefono, v.direccion,
        estadoReporteAdmin(v), v.duplicado ? 'SÍ' : '',
      ]),
      resaltar: (i) => datos.votantes[i].duplicado,
    });
  }

  return window.PDF.descargar({
    titulo: `Reporte de ${c.nombreConcejal}`,
    subtitulo: [c.opcion ? `Opción ${c.opcion}` : '', c.lista ? `Lista ${c.lista}` : ''].filter(Boolean).join(' · '),
    resumen: [
      `Preasignados: ${c.preasignados}`,
      `Registrados: ${c.registrados} (${pct(c.registrados, c.preasignados)})`,
      `Votaron con otra lista: ${c.otraLista}`,
      ...(c.sinAsignar ? [`Votaron sin asignar: ${c.sinAsignar}`] : []),
      `Pendientes: ${c.pendientes}`,
      `Duplicados: ${c.duplicados}`,
      `Asignados en Comando: ${c.asignadosEnComando}`,
    ],
    horizontal: true,
    pie,
    nombreArchivo: `Reporte ${c.nombreConcejal}`,
    secciones,
  });
}

/** Estado de un votante en el reporte del admin (aca si se dice con quien). */
function estadoReporteAdmin(v) {
  if (v.estadoGestion === 'REGISTRADO') return 'Registrado';
  if (v.estadoGestion === 'OTRA_LISTA') return `Votó con ${v.votoCon}`;
  if (v.estadoGestion === 'SIN_ASIGNAR') return 'Votó (sin asignar)';
  return 'Pendiente';
}

window.renderAdmin = renderAdmin;
