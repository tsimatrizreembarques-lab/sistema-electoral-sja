// Generacion de PDF directo en el dispositivo (sin ventana de impresion).
// Usa jsPDF + AutoTable, guardados en /vendor (no dependen de internet: el
// service worker los deja en cache, asi el PDF sale tambien sin señal). La
// libreria se carga recien la primera vez que se pide un PDF.
//
// Actualizar la libreria: npm install -D jspdf jspdf-autotable y copiar
//   node_modules/jspdf/dist/jspdf.umd.min.js
//   node_modules/jspdf-autotable/dist/jspdf.plugin.autotable.min.js
// a public/vendor/ (y subir la version del cache del service worker).

const ROJO_OSCURO = [107, 15, 15];
const AMARILLO = [254, 249, 195];

let cargaLibreria = null;

function cargarScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(s);
  });
}

function cargarLibreria() {
  if (!cargaLibreria) {
    cargaLibreria = cargarScript('/vendor/jspdf.umd.min.js')
      .then(() => cargarScript('/vendor/jspdf.plugin.autotable.min.js'))
      .catch((error) => {
        cargaLibreria = null; // permitir reintentar
        throw error;
      });
  }
  return cargaLibreria;
}

/** "Lista de JUAN PEREZ" -> "Lista-de-JUAN-PEREZ-2026-10-04.pdf" */
function nombreDeArchivo(base) {
  const limpio = String(base || 'reporte')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' }); // AAAA-MM-DD
  return `${limpio}-${hoy}.pdf`;
}

const texto = (v) => (v === null || v === undefined || v === '' ? '-' : String(v));

/**
 * Arma y descarga un PDF.
 *  titulo, subtitulo: encabezado
 *  resumen: [ 'Total 10', ... ] (una linea con los totales)
 *  secciones: [{ titulo?, columnas: [...], filas: [[...]], resaltar?: (indiceFila) => bool,
 *               alinearDerecha?: [indicesDeColumna] }]
 *  horizontal: hoja apaisada (para tablas con muchas columnas)
 *  pie: texto chico al pie de cada pagina (ej. "Confidencial")
 */
async function descargar({ titulo, subtitulo, resumen = [], secciones = [], horizontal = false, pie = '', nombreArchivo }) {
  try {
    await cargarLibreria();
  } catch (error) {
    window.Notificaciones.mostrarModal(
      'No se pudo generar el PDF',
      'No se pudo cargar el generador de PDF. Abrí la app una vez con conexión y volvé a intentar.'
    );
    return false;
  }

  const { jsPDF } = window.jspdf;
  // AutoTable normalmente se engancha solo a jsPDF; si no, se aplica a mano.
  if (!jsPDF.API.autoTable && typeof window.applyPlugin === 'function') window.applyPlugin(jsPDF);
  const doc = new jsPDF({ orientation: horizontal ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  const margen = 12;
  let y = margen + 4;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...ROJO_OSCURO);
  doc.text(titulo, margen, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(90);
  const generado = window.formatearFechaPY ? window.formatearFechaPY(new Date().toISOString()) : new Date().toLocaleString();
  const lineasSub = doc.splitTextToSize(`${subtitulo ? `${subtitulo} · ` : ''}Generado el ${generado}`, doc.internal.pageSize.getWidth() - margen * 2);
  doc.text(lineasSub, margen, y);
  y += lineasSub.length * 4 + 2;

  if (resumen.length) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(20);
    doc.text(resumen.join('     '), margen, y);
    y += 6;
  }

  for (const seccion of secciones) {
    if (seccion.titulo) {
      // Si el titulo de seccion quedaria solo al pie de la hoja, se pasa a la siguiente.
      if (y > doc.internal.pageSize.getHeight() - 30) {
        doc.addPage();
        y = margen + 4;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(20);
      doc.text(seccion.titulo, margen, y + 2);
      y += 5;
    }

    const derecha = {};
    (seccion.alinearDerecha || []).forEach((i) => { derecha[i] = { halign: 'right' }; });

    doc.autoTable({
      startY: y,
      margin: { left: margen, right: margen, bottom: 14 },
      head: [seccion.columnas],
      body: seccion.filas.map((f) => f.map(texto)),
      styles: { font: 'helvetica', fontSize: horizontal ? 7.5 : 8, cellPadding: 1.6, valign: 'top' },
      headStyles: { fillColor: ROJO_OSCURO, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 245, 245] },
      columnStyles: derecha,
      didParseCell: (data) => {
        // El encabezado de una columna numerica va alineado igual que sus numeros.
        if (data.section === 'head' && derecha[data.column.index]) data.cell.styles.halign = 'right';
        if (data.section === 'body' && seccion.resaltar && seccion.resaltar(data.row.index)) {
          data.cell.styles.fillColor = AMARILLO;
        }
      },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // Pie con numero de pagina en todas las hojas.
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    const alto = doc.internal.pageSize.getHeight();
    const ancho = doc.internal.pageSize.getWidth();
    doc.text(`Control Electoral SJA${pie ? ` · ${pie}` : ''}`, margen, alto - 7);
    doc.text(`Página ${i} de ${paginas}`, ancho - margen, alto - 7, { align: 'right' });
  }

  doc.save(nombreDeArchivo(nombreArchivo || titulo));
  return true;
}

window.PDF = { descargar };
