// Uso:
//   node scripts/borrar-lista-concejal.js "WILSON TITO ESCOBAR"        (simulacion)
//   node scripts/borrar-lista-concejal.js "WILSON TITO ESCOBAR" --si   (borra)
//
// Borra TODOS los votantes de la lista de UN concejal (documentos de
// 'votantesConcejal' con ese nombreConcejal). El match es sin distinguir
// mayusculas/minusculas ni espacios de sobra. Despues recalcula stats/resumen
// (para que 'duplicadosEntreListas' y los conteos por concejal queden bien).
//
// NO toca 'registros' (asistencia ya marcada) ni 'padron' ni 'concejales'.
// Es IRREVERSIBLE con --si.

require('dotenv').config();
const { getFirestore } = require('../src/lib/firestore');
const { recalcularTodoStats } = require('../src/lib/stats');

const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();

async function main() {
  const args = process.argv.slice(2);
  const confirmado = args.includes('--si');
  const nombreArg = args.filter((a) => a !== '--si').join(' ').trim();

  if (!nombreArg) {
    console.error('Falta el nombre del concejal. Ej: node scripts/borrar-lista-concejal.js "WILSON TITO ESCOBAR"');
    process.exit(1);
  }

  const db = getFirestore();
  const objetivo = norm(nombreArg);

  const snap = await db.collection('votantesConcejal').get();
  const aBorrar = snap.docs.filter((d) => norm(d.data().nombreConcejal) === objetivo);

  // Nombres presentes en la coleccion, por si el que se paso no coincide exacto.
  const nombresPresentes = [...new Set(snap.docs.map((d) => d.data().nombreConcejal))].sort();

  console.log(`Concejal buscado: "${nombreArg}"  ->  normalizado: "${objetivo}"`);
  console.log(`Coincidencias en 'votantesConcejal': ${aBorrar.length} de ${snap.size} documentos.`);

  if (aBorrar.length === 0) {
    console.log('');
    console.log('No se borro nada. Nombres de concejal que SI existen en la coleccion:');
    nombresPresentes.forEach((n) => console.log(`  - ${n}`));
    process.exit(0);
  }

  aBorrar.slice(0, 20).forEach((d) => {
    const v = d.data();
    console.log(`  ${v.cedula}  ${v.nombresApellidos || ''}`);
  });
  if (aBorrar.length > 20) console.log(`  ... y ${aBorrar.length - 20} mas`);

  if (!confirmado) {
    console.log('');
    console.log('Simulacion (dry-run). Para borrar de verdad:');
    console.log(`  node scripts/borrar-lista-concejal.js "${nombreArg}" --si`);
    process.exit(0);
  }

  let batch = db.batch();
  let enLote = 0;
  let borrados = 0;
  for (const doc of aBorrar) {
    batch.delete(doc.ref);
    enLote += 1;
    borrados += 1;
    if (enLote >= 450) {
      await batch.commit();
      batch = db.batch();
      enLote = 0;
      console.log(`Progreso: ${borrados}/${aBorrar.length}...`);
    }
  }
  if (enLote > 0) await batch.commit();

  console.log(`Listo. ${borrados} votantes borrados de la lista de "${nombreArg}".`);

  console.log('Recalculando stats/resumen desde cero...');
  const resumen = await recalcularTodoStats(db);
  console.log(`stats/resumen actualizado. duplicadosEntreListas: ${resumen.duplicadosEntreListas}.`);

  process.exit(0);
}

main().catch((error) => {
  console.error('Error al borrar la lista del concejal:', error);
  process.exit(1);
});
