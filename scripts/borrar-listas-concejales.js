// Uso: node scripts/borrar-listas-concejales.js --si
// Vacia POR COMPLETO la coleccion 'votantesConcejal' (las listas de TODOS los
// concejales: cada cedula que cada concejal habia agregado a su lista, con su
// caudillo). Despues recalcula stats/resumen desde cero (deja
// 'duplicadosEntreListas' y los conteos por concejal en 0).
//
// NO toca 'registros' (asistencia ya marcada), ni 'padron', ni 'concejales'
// (los concejales siguen existiendo, solo quedan con la lista vacia).
// NO toca el respaldo de Google Sheets.
//
// Es IRREVERSIBLE. Sin --si solo informa cuantos documentos borraria.

require('dotenv').config();
const { getFirestore } = require('../src/lib/firestore');
const { recalcularTodoStats } = require('../src/lib/stats');

async function main() {
  const confirmado = process.argv.includes('--si');
  const db = getFirestore();

  const snap = await db.collection('votantesConcejal').get();

  const porConcejal = {};
  snap.docs.forEach((d) => {
    const n = d.data().nombreConcejal || '(sin nombre)';
    porConcejal[n] = (porConcejal[n] || 0) + 1;
  });

  console.log(`Coleccion 'votantesConcejal': ${snap.size} documentos.`);
  Object.entries(porConcejal)
    .sort((a, b) => b[1] - a[1])
    .forEach(([n, c]) => console.log(`  ${c.toString().padStart(4)}  ${n}`));

  if (snap.size === 0) {
    console.log('No hay nada que borrar.');
    process.exit(0);
  }

  if (!confirmado) {
    console.log('');
    console.log('Simulacion (dry-run). Para borrar de verdad:');
    console.log('  node scripts/borrar-listas-concejales.js --si');
    process.exit(0);
  }

  let batch = db.batch();
  let enLote = 0;
  let borrados = 0;
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    enLote += 1;
    borrados += 1;
    if (enLote >= 450) {
      await batch.commit();
      batch = db.batch();
      enLote = 0;
      console.log(`Progreso: ${borrados}/${snap.size}...`);
    }
  }
  if (enLote > 0) await batch.commit();

  console.log(`Listo. ${borrados} entradas borradas de las listas de concejales.`);

  console.log('Recalculando stats/resumen desde cero...');
  const resumen = await recalcularTodoStats(db);
  console.log(`stats/resumen actualizado. duplicadosEntreListas: ${resumen.duplicadosEntreListas}.`);

  process.exit(0);
}

main().catch((error) => {
  console.error('Error al borrar las listas de concejales:', error);
  process.exit(1);
});
