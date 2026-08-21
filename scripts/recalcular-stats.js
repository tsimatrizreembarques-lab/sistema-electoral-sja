// Uso: node scripts/recalcular-stats.js
// Reconstruye por completo stats/resumen (los totales que usa el dashboard
// del admin) a partir de un escaneo completo de padron, registros y
// votantesConcejal. Sirve como punto de partida inicial, y como "reset" si
// alguna vez los contadores incrementales quedan desincronizados.

require('dotenv').config();
const { getFirestore } = require('../src/lib/firestore');
const { recalcularTodoStats } = require('../src/lib/stats');

async function main() {
  const db = getFirestore();
  const resumen = await recalcularTodoStats(db);
  console.log('stats/resumen recalculado:');
  console.log('  totalPadron:', resumen.totalPadron);
  console.log('  totalRegistrados:', resumen.totalRegistrados);
  console.log('  duplicadosEntreListas:', resumen.duplicadosEntreListas);
  process.exit(0);
}

main().catch((error) => {
  console.error('Error al recalcular stats:', error);
  process.exit(1);
});
