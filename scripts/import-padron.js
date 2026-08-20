// Uso: node scripts/import-padron.js /ruta/al/padron.xlsx
// Espera columnas: CEDULA, ORDEN, NOMBRES_APELLIDOS, MESA, LOCAL
// (LOCAL es obligatorio: como hay 3 locales, sin este campo la mesa no es unica)

require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { getFirestore } = require('../src/lib/firestore');
const { normalizarCedula } = require('../src/lib/normalizar');

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Uso: node scripts/import-padron.js /ruta/al/padron.xlsx');
    process.exit(1);
  }

  const workbook = XLSX.readFile(path.resolve(filePath));
  const sheetName = workbook.SheetNames.includes('PADRON') ? 'PADRON' : workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

  const db = getFirestore();
  let batch = db.batch();
  let enLote = 0;
  let total = 0;
  let omitidos = 0;

  for (const row of rows) {
    const cedula = normalizarCedula(row.CEDULA ?? row.Cedula ?? row.CI);
    const nombresApellidos = String(row.NOMBRES_APELLIDOS ?? row.Nombres ?? '').trim();
    const local = String(row.LOCAL ?? row.Local ?? '').trim();
    const mesa = Number(row.MESA ?? row.Mesa ?? 0);
    const orden = Number(row.ORDEN ?? row.Orden ?? 0);

    if (!cedula || !nombresApellidos || !local) {
      omitidos += 1;
      continue;
    }

    const ref = db.collection('padron').doc(cedula);
    batch.set(ref, { cedula, orden, nombresApellidos, local, mesa }, { merge: true });
    enLote += 1;
    total += 1;

    // Firestore permite maximo 500 operaciones por batch.
    if (enLote >= 450) {
      await batch.commit();
      batch = db.batch();
      enLote = 0;
      console.log(`Progreso: ${total} importados...`);
    }
  }

  if (enLote > 0) {
    await batch.commit();
  }

  console.log(`Importacion de padron completada. Importados: ${total}. Omitidos (datos incompletos): ${omitidos}.`);
  process.exit(0);
}

main().catch((error) => {
  console.error('Error al importar el padron:', error);
  process.exit(1);
});
