async function renderAdmin(root, perfil) {
  root.innerHTML = `
    <header class="encabezado">
      <div><strong>Dashboard Administrador</strong></div>
      <button id="btn-salir" class="link">Salir</button>
    </header>
    <main class="contenido">
      <div id="totales" class="grid-totales"></div>
      <button type="button" id="btn-pdf-listas" class="secundario" style="width:100%; margin-bottom:16px;">
        📄 Generar PDF de listas de concejales
      </button>
      <h3>Por escuela</h3>
      <div id="por-escuela"></div>
      <h3>Por concejal</h3>
      <div id="por-concejal"></div>
    </main>
  `;

  document.getElementById('btn-salir').addEventListener('click', async () => {
    await window.DBLocal.cerrarSesion();
    window.App.irA('login');
  });

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

  function tabla(objeto) {
    const entradas = Object.entries(objeto).sort((a, b) => b[1] - a[1]);
    if (entradas.length === 0) return '<p class="sub">Sin datos aún.</p>';
    return `<div class="tabla-simple">${entradas
      .map(([k, v]) => `<div class="fila"><span>${k}</span><strong>${v}</strong></div>`)
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
        <h4 style="margin:0 0 8px;">${local} <span class="sub">— ${datos.registrados}/${datos.total}</span></h4>
        <div class="tabla-simple">
          ${datos.mesas
            .map((m) => `<div class="fila"><span>Mesa ${m.mesa ?? '-'}</span><strong>${m.registrados}/${m.total}</strong></div>`)
            .join('')}
        </div>
      </div>`
      )
      .join('');
  }

  async function cargar() {
    const { ok, datos } = await window.Api.dashboardAdmin();
    if (!ok) return;

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

  await cargar();
  setInterval(cargar, 45000); // el dashboard admin ahora lee un unico documento resumen, pero no hace falta mas seguido que esto
}

/**
 * Abre una pestaña con el listado completo de TODAS las listas de TODOS los
 * concejales, en formato imprimible, y dispara el dialogo de impresion del
 * navegador (desde ahi se puede elegir "Guardar como PDF"). Mismo patron que
 * el PDF individual del concejal, pero con una columna extra de Concejal.
 */
function generarPDFListasConcejales(datos) {
  const generadoEl = window.formatearFechaPY ? window.formatearFechaPY(new Date().toISOString()) : new Date().toLocaleString();

  const filas = datos.lista
    .map(
      (v, i) => `
    <tr class="${v.duplicado ? 'duplicado' : ''}">
      <td>${i + 1}</td>
      <td>${v.opcionConcejal ?? '-'}</td>
      <td>${v.nombreConcejal || ''}</td>
      <td>${v.lista ?? '-'}</td>
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
            <th>#</th><th>Opción</th><th>Concejal</th><th>Lista</th><th>Cédula</th><th>Nombre</th><th>Local</th><th>Mesa</th><th>Caudillo</th><th>Estado</th><th>Duplicado</th>
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
