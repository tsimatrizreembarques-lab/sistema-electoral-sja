// Uso: node scripts/borrar-registros.js --si
// Vacia POR COMPLETO la coleccion 'registros' (toda la asistencia marcada desde
// comando, mesa y concejal, con su historial de intentos) y despues recalcula
// stats/resumen desde cero — asi los contadores del dashboard admin quedan en 0.
//
// NO toca padron, concejales ni votantesConcejal (las preasignaciones).
// NO toca el respaldo de Google Sheets.
//
// Es IRREVERSIBLE. Por eso exige el argumento --si para ejecutarse; sin el,
// solo informa cuantos documentos borraria y no borra nada.

require('dotenv').config();
const { getFirestore } = require('../src/lib/firestore');
const { recalcularTodoStats } = require('../src/lib/stats');

async function main() {
  const confirmado = process.argv.includes('--si');
  const db = getFirestore();

  const snap = await db.collection('registros').get();
  console.log(`Coleccion 'registros': ${snap.size} documentos.`);

  if (snap.size === 0) {
    console.log('No hay nada que borrar.');
    process.exit(0);
  }

  if (!confirmado) {
    console.log('');
    console.log('Esto es una simulacion (dry-run). Para borrar de verdad, ejecuta:');
    console.log('  node scripts/borrar-registros.js --si');
    process.exit(0);
  }

  let batch = db.batch();
  let enLote = 0;
  let borrados = 0;

  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    enLote += 1;
    borrados += 1;

    // Firestore permite maximo 500 operaciones por batch.
    if (enLote >= 450) {
      await batch.commit();
      batch = db.batch();
      enLote = 0;
      console.log(`Progreso: ${borrados}/${snap.size} borrados...`);
    }
  }

  if (enLote > 0) {
    await batch.commit();
  }

  console.log(`Listo. ${borrados} registros borrados.`);

  console.log('Recalculando stats/resumen desde cero...');
  const resumen = await recalcularTodoStats(db);
  console.log(`stats/resumen actualizado. totalRegistrados: ${resumen.totalRegistrados}.`);

  process.exit(0);
}

main().catch((error) => {
  console.error('Error al borrar los registros:', error);
  process.exit(1);
});
