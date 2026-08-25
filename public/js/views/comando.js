let modoComando = 'registrar';

async function renderComando(root, perfil) {
  root.innerHTML = `
    <header class="encabezado">
      <div>
        <strong>Puesto de Comando</strong>
        <span class="sub">${perfil.local}</span>
      </div>
      <div class="acciones-header">
        <span id="estado-sync" class="badge">—</span>
        <button id="btn-salir" class="link">Salir</button>
      </div>
    </header>

    <main class="contenido">
      <div class="modo-busqueda">
        <button type="button" id="modo-registrar" class="modo activo">Registrar</button>
        <button type="button" id="modo-consultar" class="modo">Consultar</button>
      </div>
      <form id="form-buscar" class="fila-busqueda">
        <input id="cedula" type="text" inputmode="numeric" placeholder="Número de cédula" autofocus />
        <button type="submit">Buscar</button>
      </form>

      <div id="resultado"></div>
    </main>
  `;

  document.getElementById('btn-salir').addEventListener('click', async () => {
    await window.DBLocal.cerrarSesion();
    window.App.irA('login');
  });

  modoComando = 'registrar';
  document.getElementById('modo-registrar').addEventListener('click', () => actualizarModoComando('registrar'));
  document.getElementById('modo-consultar').addEventListener('click', () => actualizarModoComando('consultar'));

  // Refresca la lista de concejales contra el servidor cada vez que se abre
  // esta pantalla (si hay señal): asi los dispositivos que ya estaban
  // logueados desde antes de que existiera esta funcion tambien la reciben,
  // sin tener que cerrar sesion y volver a entrar.
  if (navigator.onLine) {
    window.Api.listarConcejales().then(({ ok, datos }) => {
      if (ok) window.DBLocal.guardarConcejales(datos.concejales);
    });
  }

  window.Sync.iniciarSyncAutomatico(({ estado, pendientes }) => {
    const el = document.getElementById('estado-sync');
    if (!el) return;
    if (estado === 'sincronizando') el.textContent = 'Sincronizando…';
    else if (estado === 'al-dia') el.textContent = 'Todo sincronizado';
    else if (estado === 'sincronizado') el.textContent = pendientes > 0 ? `${pendientes} pendientes` : 'Todo sincronizado';
    else if (estado === 'error') el.textContent = 'Sin conexión (guardando local)';
  });

  document.getElementById('form-buscar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cedula = document.getElementById('cedula').value.trim();
    if (!cedula) return;

    const cedulaLimpia = cedula.replace(/\D/g, '');

    const concejales = await window.DBLocal.obtenerConcejales();

    if (modoComando === 'consultar') {
      // Consultar: busca en TODO el padron (todos los locales), no solo el propio.
      // Requiere conexion, ya que el dispositivo solo tiene descargado su local.
      const { ok, datos } = await window.Api.buscarVotante(cedulaLimpia);
      renderResultadoComando(ok ? datos : null, cedula, perfil, modoComando, concejales);
      return;
    }

    // Registrar: offline-first, siempre busca primero en la base local del dispositivo.
    let votante = await window.DBLocal.buscarVotante(cedulaLimpia);

    if (!votante && navigator.onLine) {
      // No esta en el paquete local: puede ser que se haya agregado al padron
      // DESPUES de que este dispositivo inicio sesion (el paquete se descarga
      // una sola vez, al loguearse). Se busca en el servidor antes de decir
      // que no existe, y si corresponde a este mismo local, se guarda para
      // quedar disponible offline de ahi en mas.
      const { ok, datos } = await window.Api.buscarVotante(cedulaLimpia);
      if (ok && datos.local === perfil.local) {
        await window.DBLocal.guardarVotanteDescubierto(datos);
        votante = await window.DBLocal.buscarVotante(cedulaLimpia);
      }
    } else if (votante && navigator.onLine) {
      // Si hay señal, se refresca el estado contra el servidor: otro dispositivo
      // (ej. una Mesa) puede haber registrado a esta persona despues de que este
      // dispositivo descargo su paquete local, y el cache local no se entera solo.
      const { ok, datos } = await window.Api.buscarVotante(cedulaLimpia);
      if (ok && datos.registroActual) {
        votante = { ...votante, registroActual: datos.registroActual };
        await window.DBLocal.marcarRegistradoLocalmente(datos.registroActual);
      }
    }

    renderResultadoComando(votante, cedula, perfil, modoComando, concejales);
  });
}

function actualizarModoComando(nuevoModo) {
  modoComando = nuevoModo;
  document.getElementById('modo-registrar').classList.toggle('activo', nuevoModo === 'registrar');
  document.getElementById('modo-consultar').classList.toggle('activo', nuevoModo === 'consultar');
  document.getElementById('resultado').innerHTML = '';
  const inputCedula = document.getElementById('cedula');
  if (inputCedula) { inputCedula.value = ''; inputCedula.focus(); }
}

function renderResultadoComando(votante, cedulaBuscada, perfil, modo, concejales) {
  const cont = document.getElementById('resultado');

  if (!votante) {
    cont.innerHTML = modo === 'consultar'
    ? `<div class="tarjeta alerta">No se encontró la cédula ${cedulaBuscada} en el padrón de SJA.</div>`
    : `<div class="tarjeta alerta">No se encontró la cédula ${cedulaBuscada} en el padrón de este local.</div>`;
    return;
  }

  if (votante.registroActual?.estadoGestion === 'REGISTRADO') {
    const historial = window.formatearHistorial(votante.registroActual.historial);
    cont.innerHTML = `
      <div class="tarjeta ok">
        <h3>${votante.nombresApellidos}</h3>
        <p>Orden: ${votante.orden ?? '-'}</p>
        <p>Ya fue registrado: <strong>${votante.registroActual.origenRegistro}</strong></p>
        <p>Hora: ${window.formatearFechaPY(votante.registroActual.fechaHora)}</p>
        <p>Concejal asignado: <strong>${votante.registroActual.concejalAsignado || 'Sin concejal asignado'}</strong>${votante.registroActual.listaAsignada ? ` (Lista ${votante.registroActual.listaAsignada})` : ''}</p>
        <p class="grande">Mesa ${votante.mesa} — ${votante.local}</p>
        ${historial ? `<p class="sub" style="white-space:pre-line;">Historial:\n${historial}</p>` : ''}
      </div>
    `;
    window.Notificaciones?.avisar(
      'Votante ya registrado',
      `${votante.nombresApellidos} ya pasó por: ${votante.registroActual.origenRegistro}`
    );
    return;
  }

  // Mensaje informativo de concejalia preasignada (se usa en Consultar, y
  // como aviso arriba del selector en Registrar).
  let infoConcejal = '';
  if (votante.duplicadoAmbiguo) {
    infoConcejal = `<p class="advertencia">Esta cédula figura en más de una lista de concejal: ${votante.preasignados
      .map((p) => `${p.nombreConcejal} (Lista ${p.lista})`)
      .join(', ')}. Preguntale al votante a quién apoya.</p>`;
  } else if (votante.preasignados.length === 1) {
    infoConcejal = `<p>Concejalía preasignada: <strong>${votante.preasignados[0].nombreConcejal} (Lista ${votante.preasignados[0].lista})</strong></p>`;
  } else {
    infoConcejal = `<p class="sub">Sin concejalía preasignada.</p>`;
  }

  if (modo === 'consultar') {
    cont.innerHTML = `
      <div class="tarjeta">
        <h3>${votante.nombresApellidos}</h3>
        <p>Orden: ${votante.orden ?? '-'}</p>
        <p class="grande">Mesa ${votante.mesa} — ${votante.local}</p>
        ${infoConcejal}
        <p class="sub">Modo consulta: no se registra ningun paso.</p>
      </div>
    `;
    return;
  }

  // Registrar: siempre se puede elegir (o corregir) el concejal asignado,
  // tenga o no una preasignacion — asi nunca queda un voto sin poder
  // asignarse a nadie, ni sin forma de corregirlo despues.
  const concejalPreseleccionado = votante.duplicadoAmbiguo ? '' : votante.preasignados[0]?.nombreConcejal || '';
  const opcionesSelect = (concejales || [])
    .slice()
    .sort((a, b) => (a.opcion ?? 999) - (b.opcion ?? 999) || (a.nombreConcejal || '').localeCompare(b.nombreConcejal || ''))
    .map(
      (c) =>
        `<option value="${c.nombreConcejal}" data-lista="${c.lista ?? ''}" ${
          c.nombreConcejal === concejalPreseleccionado ? 'selected' : ''
        }>${c.opcion ? `Opción ${c.opcion} — ` : ''}${c.nombreConcejal} (Lista ${c.lista ?? '-'})</option>`
    )
    .join('');

  cont.innerHTML = `
    <div class="tarjeta">
      <h3>${votante.nombresApellidos}</h3>
      <p>Orden: ${votante.orden ?? '-'}</p>
      <p class="grande">Dirigir a: Mesa ${votante.mesa} — ${votante.local}</p>
      ${infoConcejal}
      <label class="sub" style="display:block; margin: 8px 0 4px;">Concejal asignado</label>
      <select id="select-concejal" style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--gris-claro); margin-bottom:12px;">
        <option value="">Sin concejal</option>
        ${opcionesSelect}
      </select>
      <button id="btn-registrar" class="primario">Registrar paso por comando</button>
    </div>
  `;

  document.getElementById('btn-registrar').addEventListener('click', async () => {
    const select = document.getElementById('select-concejal');
    const concejalAsignado = select.value || null;
    const listaAsignada = concejalAsignado ? select.options[select.selectedIndex].dataset.lista || null : null;

    await registrarDesdeDispositivo({
      votante,
      listaAsignada,
      concejalAsignado,
      perfil,
      origenLocal: `Registrado en Puesto Comando (${perfil.local})`,
    });

    document.getElementById('resultado').innerHTML = `
      <div class="tarjeta ok">
        Registrado. Dirigido a Mesa ${votante.mesa}.
        <p>Concejal asignado: <strong>${concejalAsignado || 'Sin concejal asignado'}</strong>${listaAsignada ? ` (Lista ${listaAsignada})` : ''}</p>
      </div>
    `;
    document.getElementById('cedula').value = '';
    document.getElementById('cedula').focus();
  });
}

/**
 * Registra localmente de inmediato (optimista) y encola para sincronizar.
 * Compartida entre la vista de Comando y la de Mesa.
 */
async function registrarDesdeDispositivo({ votante, listaAsignada, concejalAsignado, perfil, origenLocal }) {
  const fechaHora = new Date().toISOString();
  const dispositivoId = await obtenerDispositivoId();

  const registroLocal = {
    cedula: votante.cedula,
    nombresApellidos: votante.nombresApellidos,
    local: votante.local,
    mesa: votante.mesa,
    listaPreasignada: votante.preasignados[0]?.lista ?? null,
    concejalPreasignado: votante.preasignados.map((p) => p.nombreConcejal).join(' / ') || null,
    listaAsignada,
    concejalAsignado,
    estadoGestion: 'REGISTRADO',
    origenRegistro: origenLocal,
    fechaHora,
    dispositivoId,
  };

  // Optimista: se marca local ya mismo, para que la app se sienta instantánea
  // aunque no haya señal en este momento.
  await window.DBLocal.marcarRegistradoLocalmente(registroLocal);
  await window.DBLocal.encolarRegistro({
    cedula: votante.cedula,
    listaAsignada,
    concejalAsignado,
    fechaHora,
    dispositivoId,
  });

  window.Sync.sincronizarAhora();
}

async function obtenerDispositivoId() {
  let id = localStorage.getItem('dispositivo-id');
  if (!id) {
    id = `dispositivo-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('dispositivo-id', id);
  }
  return id;
}

window.renderComando = renderComando;
window.registrarDesdeDispositivo = registrarDesdeDispositivo;
