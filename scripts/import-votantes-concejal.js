// Uso: node scripts/import-votantes-concejal.js /ruta/al/archivo.xlsx
// Espera columnas: CEDULA, NOMBRE_CONCEJAL, LISTA
// No bloquea por duplicados (una cedula en +1 lista es un caso REAL, se resuelve
// en vivo en el puesto de comando) — pero al final imprime un reporte informativo.

require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { getFirestore } = require('../src/lib/firestore');
const { normalizarCedula } = require('../src/lib/normalizar');

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Uso: node scripts/import-votantes-concejal.js /ruta/al/archivo.xlsx');
    process.exit(1);
  }

  const workbook = XLSX.readFile(path.resolve(filePath));
  const sheetName = workbook.SheetNames.includes('VOTANTES_CONCEJAL')
    ? 'VOTANTES_CONCEJAL'
    : workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

  const db = getFirestore();
  let batch = db.batch();
  let enLote = 0;
  let total = 0;
  let sinCedulaEnPadron = 0;
  const conteoPorCedula = {};

  // Pre-cargamos el set de cedulas del padron para validar sin pegarle a Firestore por cada fila.
  const padronSnap = await db.collection('padron').select().get();
  const cedulasPadron = new Set(padronSnap.docs.map((d) => d.id));

  for (const row of rows) {
    const cedula = normalizarCedula(row.CEDULA);
    const nombreConcejal = String(row.NOMBRE_CONCEJAL ?? '').trim();
    const lista = Number(row.LISTA ?? 0);

    if (!cedula || !nombreConcejal) continue;

    if (!cedulasPadron.has(cedula)) {
      sinCedulaEnPadron += 1;
    }

    conteoPorCedula[cedula] = (conteoPorCedula[cedula] || 0) + 1;

    // doc id compuesto para permitir multiples concejales por cedula
    const ref = db.collection('votantesConcejal').doc(`${cedula}__${nombreConcejal}`);
    batch.set(ref, { cedula, nombreConcejal, lista }, { merge: true });
    enLote += 1;
    total += 1;

    if (enLote >= 450) {
      await batch.commit();
      batch = db.batch();
      enLote = 0;
    }
  }

  if (enLote > 0) {
    await batch.commit();
  }

  const duplicados = Object.entries(conteoPorCedula).filter(([, c]) => c > 1);

  console.log(`Votantes de concejales importados: ${total}.`);
  console.log(`Cedulas no encontradas en el padron: ${sinCedulaEnPadron}.`);
  console.log(`Cedulas preasignadas a MAS DE UN concejal (se resuelven en comando el dia de la eleccion): ${duplicados.length}.`);
  if (duplicados.length) {
    console.log('Primeras 10 cedulas duplicadas:', duplicados.slice(0, 10).map(([c]) => c).join(', '));
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('Error al importar votantes de concejales:', error);
  process.exit(1);
});
