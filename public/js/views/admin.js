async function renderAdmin(root, perfil) {
  root.innerHTML = `
    <header class="encabezado">
      <div><strong>Dashboard Administrador</strong></div>
      <button id="btn-salir" class="link">Salir</button>
    </header>
    <main class="contenido">
      <div id="totales" class="grid-totales"></div>
      <h3>Por local</h3>
      <div id="por-local"></div>
      <h3>Por mesa</h3>
      <div id="por-mesa"></div>
      <h3>Por concejal</h3>
      <div id="por-concejal"></div>
    </main>
  `;

  document.getElementById('btn-salir').addEventListener('click', async () => {
    await window.DBLocal.cerrarSesion();
    window.App.irA('login');
  });

  function tabla(objeto) {
    const entradas = Object.entries(objeto).sort((a, b) => b[1] - a[1]);
    if (entradas.length === 0) return '<p class="sub">Sin datos aún.</p>';
    return `<div class="tabla-simple">${entradas
      .map(([k, v]) => `<div class="fila"><span>${k}</span><strong>${v}</strong></div>`)
      .join('')}</div>`;
  }

  function tablaPorMesa(objeto) {
    const entradas = Object.entries(objeto).sort((a, b) => b[1].total - a[1].total);
    if (entradas.length === 0) return '<p class="sub">Sin datos aún.</p>';
    return `<div class="tabla-simple">${entradas
      .map(([k, c]) => `<div class="fila"><span>${k}</span><strong>${c.registrados}/${c.total}</strong></div>`)
      .join('')}</div>`;
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

    document.getElementById('por-local').innerHTML = tabla(datos.porLocal);
    document.getElementById('por-mesa').innerHTML = tablaPorMesa(datos.porMesa);
    document.getElementById('por-concejal').innerHTML = tabla(datos.porConcejal);
  }

  await cargar();
  setInterval(cargar, 15000);
}

window.renderAdmin = renderAdmin;
