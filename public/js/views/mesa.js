let modoBusquedaMesa = 'orden'; // 'orden' | 'cedula'

async function renderMesa(root, perfil) {
  root.innerHTML = `
    <header class="encabezado">
      <div>
        <strong>Mesa ${perfil.mesa}</strong>
        <span class="sub">${perfil.local}</span>
      </div>
      <div class="acciones-header">
        <span id="estado-sync" class="badge"></span>
        <button id="btn-salir" class="link">Salir</button>
      </div>
    </header>

    <main class="contenido">
      <div class="modo-busqueda">
        <button type="button" id="modo-orden" class="modo activo">N° de Orden</button>
        <button type="button" id="modo-cedula" class="modo">Cédula</button>
      </div>
      <form id="form-buscar" class="fila-busqueda">
        <input id="valor-busqueda" type="text" inputmode="numeric" placeholder="Número de orden" autofocus />
        <button type="submit">Buscar</button>
      </form>

      <div id="resultado"></div>
    </main>
  `;

  modoBusquedaMesa = 'orden';

  document.getElementById('btn-salir').addEventListener('click', async () => {
    await window.DBLocal.cerrarSesion();
    window.App.irA('login');
  });

  window.Sync.iniciarSyncAutomatico(({ estado, pendientes }) => {
    const el = document.getElementById('estado-sync');
    if (!el) return;
    if (estado === 'sincronizando') el.textContent = 'Sincronizando';
    else if (estado === 'al-dia') el.textContent = 'Todo sincronizado';
    else if (estado === 'sincronizado') el.textContent = pendientes > 0 ? `${pendientes} pendientes` : 'Todo sincronizado';
    else if (estado === 'error') el.textContent = 'Sin conexión (guardando local)';
  });

  function actualizarModo(nuevoModo) {
    modoBusquedaMesa = nuevoModo;
    document.getElementById('modo-orden').classList.toggle('activo', nuevoModo === 'orden');
    document.getElementById('modo-cedula').classList.toggle('activo', nuevoModo === 'cedula');
    const input = document.getElementById('valor-busqueda');
    input.placeholder = nuevoModo === 'orden' ? 'Número de orden' : 'Número de cédula';
    input.value = '';
    input.focus();
  }

  document.getElementById('modo-orden').addEventListener('click', () => actualizarModo('orden'));
  document.getElementById('modo-cedula').addEventListener('click', () => actualizarModo('cedula'));

  document.getElementById('form-buscar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const valor = document.getElementById('valor-busqueda').value.trim();
    if (!valor) return;

    let votante = modoBusquedaMesa === 'orden'
      ? await window.DBLocal.buscarVotantePorOrden(valor)
      : await window.DBLocal.buscarVotante(valor.replace(/\D/g, ''));

    if (!votante && modoBusquedaMesa === 'cedula' && navigator.onLine) {
      // No esta en el paquete local: puede ser que se haya agregado al padron
      // DESPUES de que este dispositivo inicio sesion. Se busca en el servidor
      // antes de decir que no existe.
      const { ok, datos } = await window.Api.buscarVotante(valor.replace(/\D/g, ''));
      if (ok && datos.local === perfil.local && datos.mesa === perfil.mesa) {
        await window.DBLocal.guardarVotanteDescubierto(datos);
        votante = await window.DBLocal.buscarVotante(datos.cedula);
      }
    } else if (votante && navigator.onLine) {
      // Si hay señal, se refresca el estado contra el servidor: otro dispositivo
      // (comando u otra mesa) puede haber registrado a esta persona despues de
      // que este dispositivo descargo su paquete local.
      const { ok, datos } = await window.Api.buscarVotante(votante.cedula);
      if (ok && datos.registroActual) {
        votante = { ...votante, registroActual: datos.registroActual };
        await window.DBLocal.marcarRegistradoLocalmente(datos.registroActual);
      }
    }

    renderResultadoMesa(votante, valor, perfil);
  });
}

function renderResultadoMesa(votante, valorBuscado, perfil) {
  const cont = document.getElementById('resultado');

  if (!votante) {
    cont.innerHTML = `<div class="tarjeta alerta">No se encontró "${valorBuscado}" en esta mesa.</div>`;
    return;
  }

  if (votante.mesa !== perfil.mesa || votante.local !== perfil.local) {
    cont.innerHTML = `<div class="tarjeta alerta">Esta persona corresponde a otra mesa: Mesa ${votante.mesa} — ${votante.local}.</div>`;
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
        ${historial ? `<p class="sub" style="white-space:pre-line;">Historial:\n${historial}</p>` : ''}
        <p class="sub">¿Confirmás igual el registro en esta mesa?</p>
        <button id="btn-forzar" class="secundario">Sí, confirmar de todas formas</button>
      </div>
    `;
    document.getElementById('btn-forzar').addEventListener('click', () => {
      confirmarRegistroMesa(votante, perfil);
    });
    window.Notificaciones?.avisar(
      'Votante ya registrado',
      `${votante.nombresApellidos} ya pasó por: ${votante.registroActual.origenRegistro}`
    );
    return;
  }

  cont.innerHTML = `
    <div class="tarjeta">
      <h3>${votante.nombresApellidos}</h3>
      <p>Orden: ${votante.orden ?? '-'}</p>
      <button id="btn-registrar" class="primario">Confirmar votó</button>
    </div>
  `;

  document.getElementById('btn-registrar').addEventListener('click', () => {
    confirmarRegistroMesa(votante, perfil);
  });
}

async function confirmarRegistroMesa(votante, perfil) {
  const listaAsignada = votante.registroActual?.listaAsignada ?? votante.preasignados[0]?.lista ?? null;
  const concejalAsignado = votante.registroActual?.concejalAsignado ?? votante.preasignados[0]?.nombreConcejal ?? null;

  await window.registrarDesdeDispositivo({
    votante,
    listaAsignada,
    concejalAsignado,
    perfil,
    origenLocal: `Registrado como Veedor Mesa ${perfil.mesa} — ${perfil.local}`,
  });

  document.getElementById('resultado').innerHTML = `<div class="tarjeta ok">Registrado correctamente.</div>`;
  document.getElementById('valor-busqueda').value = '';
  document.getElementById('valor-busqueda').focus();
}

window.renderMesa = renderMesa;
