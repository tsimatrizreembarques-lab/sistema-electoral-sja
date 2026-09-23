async function renderConcejal(root, perfil) {
  const esc = window.escaparHTML;

  root.innerHTML = `
    <header class="encabezado">
      <div>
        <strong>${esc(perfil.nombreConcejal)}</strong>
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

  document.getElementById('btn-salir').addEventListener('click', () => window.App.salir());

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
      prev.innerHTML = `<div class="tarjeta alerta">${esc(datos?.error || 'No se pudo buscar.')}</div>`;
      return;
    }
    if (datos.yaEnMiLista) {
      prev.innerHTML = `<div class="tarjeta alerta"><p>${esc(datos.nombresApellidos)}</p><p class="sub">Ya está en tu lista.</p></div>`;
      return;
    }
    if (datos.yaRegistrado) {
      prev.innerHTML = `
        <div class="tarjeta alerta">
          <p>${esc(datos.nombresApellidos)}</p>
          <p class="sub">Ya fue registrado. No se puede agregar a una lista después de votar.</p>
        </div>
      `;
      return;
    }
    prev.innerHTML = `
      <div class="tarjeta">
        <h3>${esc(datos.nombresApellidos)}</h3>
        <input id="caudillo-agregar" type="text" placeholder="Caudillo (opcional)" />
        <input id="telefono-agregar" type="tel" inputmode="tel" placeholder="Teléfono / WhatsApp (opcional) ej. 0981 123456" />
        <input id="direccion-agregar" type="text" placeholder="Dirección (opcional)" style="margin-bottom:12px;" />
        <button id="btn-confirmar-agregar" class="primario">Agregar a mi lista</button>
      </div>
    `;
    document.getElementById('btn-confirmar-agregar').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; // evita agregar dos veces con doble toque
      const resp = await window.Api.concejalAgregar(datos.cedula, {
        caudillo: document.getElementById('caudillo-agregar').value.trim(),
        telefono: document.getElementById('telefono-agregar').value.trim(),
        direccion: document.getElementById('direccion-agregar').value.trim(),
      });
      if (!resp.ok) {
        // Si el error es del telefono, se deja corregir sin volver a buscar.
        if (resp.status === 400) {
          btn.disabled = false;
          window.Notificaciones.mostrarModal('Revisá los datos', resp.datos?.error || 'Datos inválidos.');
          return;
        }
        prev.innerHTML = `<div class="tarjeta alerta">${esc(resp.datos?.error || 'No se pudo agregar.')}</div>`;
        return;
      }
      prev.innerHTML = '<div class="tarjeta ok">Agregado correctamente.</div>';
      document.getElementById('cedula-agregar').value = '';
      await cargar();
    });
  }

  document.getElementById('lista').addEventListener('click', async (e) => {
    const btnEditar = e.target.closest('.btn-editar');
    if (btnEditar) {
      const v = (ultimosDatos?.votantes || []).find((x) => x.cedula === btnEditar.dataset.cedula);
      if (!v) return;
      const valores = await window.Notificaciones.formularioModal(`Contacto de ${v.nombresApellidos}`, [
        { id: 'telefono', etiqueta: 'Teléfono / WhatsApp', valor: v.telefono || '', tipo: 'tel', inputmode: 'tel', placeholder: 'ej. 0981 123456' },
        { id: 'direccion', etiqueta: 'Dirección', valor: v.direccion || '', placeholder: 'Opcional' },
      ]);
      if (!valores) return;
      const resp = await window.Api.concejalEditarContacto(v.cedula, valores);
      if (!resp.ok) {
        window.Notificaciones.mostrarModal('No se pudo guardar', resp.datos?.error || 'No se pudo guardar el contacto.');
        return;
      }
      await cargar();
      return;
    }

    const btnEliminar = e.target.closest('.btn-eliminar');
    if (btnEliminar) {
      const cedula = btnEliminar.dataset.cedula;
      const confirmado = await window.Notificaciones.confirmarModal(
        'Eliminar votante', '¿Eliminar a esta persona de tu lista?', 'Eliminar'
      );
      if (!confirmado) return;
      const resp = await window.Api.concejalEliminar(cedula);
      if (!resp.ok) {
        window.Notificaciones.mostrarModal('No se pudo eliminar', resp.datos?.error || 'No se pudo eliminar.');
      }
      await cargar();
    }
  });

  async function cargar() {
    const resumen = document.getElementById('resumen');
    if (!resumen) return; // se cambio de pantalla mientras se esperaba la respuesta
    const { ok, datos } = await window.Api.dashboardConcejal();
    if (!document.getElementById('resumen')) return;
    if (!ok) {
      resumen.innerHTML = '<p class="alerta">No se pudo cargar (¿hay conexión?).</p>';
      return;
    }
    ultimosDatos = datos;

    resumen.innerHTML = `
      <p>Total asignado: <strong>${datos.totalAsignado}</strong></p>
      <p>Registrados: <strong>${datos.totalRegistrado}</strong> · Pendientes: <strong>${datos.totalPendiente}</strong></p>
    `;

    const entradasPorMesa = Object.entries(datos.porMesa || {}).sort((a, b) => b[1].total - a[1].total);
    document.getElementById('por-mesa').innerHTML = entradasPorMesa.length === 0
      ? '<p class="sub">Sin datos aún.</p>'
      : `<div class="tabla-simple">${entradasPorMesa
          .map(([clave, c]) => `<div class="fila"><span>${esc(clave)}</span><strong>${c.registrados}/${c.total}</strong></div>`)
          .join('')}</div>`;

    document.getElementById('lista').innerHTML = datos.votantes
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
          ${v.direccion ? `<span class="sub contacto">📍 ${esc(v.direccion)}</span>` : ''}
          ${wa ? `<span class="contacto"><a class="btn-whatsapp" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp ${esc(v.telefono)}</a></span>` : ''}
        </span>
        <span class="estado">${registrado ? 'Registrado' : 'Pendiente'}</span>
        <span class="acciones-fila">
          <button class="btn-editar" data-cedula="${esc(v.cedula)}">${v.telefono || v.direccion ? 'Editar contacto' : '+ Contacto'}</button>
          ${registrado ? '' : `<button class="btn-eliminar" data-cedula="${esc(v.cedula)}">Eliminar</button>`}
        </span>
      </div>`;
      })
      .join('');
  }

  await cargar();
  window.App.intervaloDeVista(cargar, 25000); // actualizacion en vivo mientras haya señal
}

/**
 * Abre una pestaña con la lista en formato imprimible y dispara el dialogo
 * de impresion del navegador (desde ahi se puede elegir "Guardar como PDF").
 * No usa ninguna libreria externa: es la forma mas simple y confiable de
 * generar un PDF que funcione tambien offline, sin depender del servidor.
 */
function generarPDFLista(datos, perfil) {
  const esc = window.escaparHTML;
  const votantes = [...datos.votantes].sort((a, b) => {
    const localA = a.local || '', localB = b.local || '';
    if (localA !== localB) return localA.localeCompare(localB);
    if ((a.mesa || 0) !== (b.mesa || 0)) return (a.mesa || 0) - (b.mesa || 0);
    return (a.nombresApellidos || '').localeCompare(b.nombresApellidos || '');
  });

  const generadoEl = window.formatearFechaPY ? window.formatearFechaPY(new Date().toISOString()) : new Date().toLocaleString();

  const filas = votantes
    .map(
      (v, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(v.cedula)}</td>
      <td>${esc(v.nombresApellidos)}</td>
      <td>${esc(v.local || '-')}</td>
      <td>${esc(v.mesa ?? '-')}</td>
      <td>${esc(v.caudillo || '-')}</td>
      <td>${esc(v.telefono || '-')}</td>
      <td>${esc(v.direccion || '-')}</td>
      <td>${v.estadoGestion === 'REGISTRADO' ? 'Registrado' : 'Pendiente'}</td>
    </tr>`
    )
    .join('');

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <title>Lista de votantes - ${esc(perfil.nombreConcejal)}</title>
      <style>
        body { font-family: Arial, sans-serif; color: #111; padding: 24px; }
        h1 { font-size: 1.3rem; margin-bottom: 4px; }
        .sub { color: #555; font-size: 0.85rem; margin-bottom: 16px; }
        .resumen { display: flex; gap: 24px; margin-bottom: 16px; font-size: 0.9rem; }
        .resumen strong { display: block; font-size: 1.2rem; }
        table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
        th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
        th { background: #f1f1f1; }
        @media print {
          body { padding: 0; }
          button { display: none; }
        }
      </style>
    </head>
    <body>
      <h1>Lista de votantes — ${esc(perfil.nombreConcejal)}</h1>
      <p class="sub">Generado el ${generadoEl}</p>
      <div class="resumen">
        <span>Total asignado <strong>${datos.totalAsignado}</strong></span>
        <span>Registrados <strong>${datos.totalRegistrado}</strong></span>
        <span>Pendientes <strong>${datos.totalPendiente}</strong></span>
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th><th>Cédula</th><th>Nombre</th><th>Local</th><th>Mesa</th><th>Caudillo</th><th>Teléfono</th><th>Dirección</th><th>Estado</th>
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

window.renderConcejal = renderConcejal;
