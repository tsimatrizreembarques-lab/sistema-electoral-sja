// Uso:
//   node scripts/reiniciar-datos.js        (simulacion: solo cuenta lo que borraria)
//   node scripts/reiniciar-datos.js --si   (borra)
//
// Deja el sistema en cero para arrancar con datos reales, despues de las pruebas:
//   - vacia 'registros' (asistencia marcada en Comando/Mesa, con su historial)
//   - vacia 'votantesConcejal' (las listas de TODOS los concejales)
//   - recalcula stats/resumen desde cero (dashboard admin en 0)
//   - vacia las pestañas REGISTROS y LISTAS_CONCEJALES del Sheet de respaldo
//     (conserva la fila de encabezados)
//
// NO toca 'padron', 'concejales' ni 'usuarios'.
// Es IRREVERSIBLE con --si.

require('dotenv').config();
const { google } = require('googleapis');
const { getFirestore } = require('../src/lib/firestore');
const { recalcularTodoStats } = require('../src/lib/stats');

const COLECCIONES = ['registros', 'votantesConcejal'];
const PESTANAS = ['REGISTROS', 'LISTAS_CONCEJALES'];

async function vaciarColeccion(db, nombre, snap) {
  let batch = db.batch();
  let enLote = 0;
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    enLote += 1;
    if (enLote >= 450) {
      await batch.commit();
      batch = db.batch();
      enLote = 0;
    }
  }
  if (enLote > 0) await batch.commit();
  console.log(`  '${nombre}': ${snap.size} documentos borrados.`);
}

function clienteSheets() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_CONTENT);
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
}

async function main() {
  const confirmado = process.argv.includes('--si');
  const db = getFirestore();
  const sheetId = process.env.GOOGLE_SHEET_ID_BACKUP;

  const snaps = {};
  for (const nombre of COLECCIONES) {
    snaps[nombre] = await db.collection(nombre).get();
    console.log(`Coleccion '${nombre}': ${snaps[nombre].size} documentos.`);
  }

  let sheets = null;
  const pestanasExistentes = [];
  if (sheetId) {
    sheets = clienteSheets();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const titulos = meta.data.sheets.map((s) => s.properties.title);
    for (const p of PESTANAS) {
      if (!titulos.includes(p)) continue;
      pestanasExistentes.push(p);
      const vals = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${p}!A2:A` });
      console.log(`Sheet pestaña '${p}': ${(vals.data.values || []).length} filas (sin contar encabezado).`);
    }
  } else {
    console.log('GOOGLE_SHEET_ID_BACKUP no configurado: no se limpia el Sheet.');
  }

  if (!confirmado) {
    console.log('');
    console.log('Simulacion: no se borro nada. Para borrar de verdad:');
    console.log('  node scripts/reiniciar-datos.js --si');
    process.exit(0);
  }

  console.log('');
  console.log('Borrando...');
  for (const nombre of COLECCIONES) {
    await vaciarColeccion(db, nombre, snaps[nombre]);
  }

  const resumen = await recalcularTodoStats(db);
  console.log(
    `  stats/resumen: totalPadron ${resumen.totalPadron}, totalRegistrados ${resumen.totalRegistrados}, ` +
      `duplicadosEntreListas ${resumen.duplicadosEntreListas}.`
  );

  for (const p of pestanasExistentes) {
    await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: `${p}!A2:Z` });
    console.log(`  Sheet '${p}': vaciada (encabezado conservado).`);
  }

  console.log('Listo. Sistema en cero.');
  process.exit(0);
}

main().catch((error) => {
  console.error('Error al reiniciar los datos:', error);
  process.exit(1);
});
