// Uso: node scripts/import-concejales.js /ruta/al/archivo.xlsx
// Espera columnas: NOMBRE_CONCEJAL, LISTA

require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { getFirestore } = require('../src/lib/firestore');

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Uso: node scripts/import-concejales.js /ruta/al/archivo.xlsx');
    process.exit(1);
  }

  const workbook = XLSX.readFile(path.resolve(filePath));
  const sheetName = workbook.SheetNames.includes('CONCEJALES') ? 'CONCEJALES' : workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

  const db = getFirestore();
  const batch = db.batch();
  let total = 0;

  for (const row of rows) {
    const nombreConcejal = String(row.NOMBRE_CONCEJAL ?? '').trim();
    const lista = Number(row.LISTA ?? 0);
    if (!nombreConcejal) continue;

    const ref = db.collection('concejales').doc(nombreConcejal);
    batch.set(ref, { nombreConcejal, lista }, { merge: true });
    total += 1;
  }

  await batch.commit();
  console.log(`Concejales importados: ${total}.`);
  process.exit(0);
}

main().catch((error) => {
  console.error('Error al importar concejales:', error);
  process.exit(1);
});
