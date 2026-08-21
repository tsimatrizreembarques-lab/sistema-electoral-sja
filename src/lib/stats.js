// Contadores agregados del sistema, mantenidos en UN SOLO documento
// (stats/resumen) para que el dashboard del admin no tenga que escanear
// colecciones enteras (padron tiene miles de documentos) cada vez que se
// actualiza. Los contadores se van incrementando/decrementando en el mismo
// momento en que ocurre cada evento (registro, alta/baja en lista de
// concejal); este archivo tambien tiene las funciones de "reset" que
// recalculan todo desde cero por si alguna vez quedan desincronizados.

const { admin } = require('./firestore');

const STATS_COLLECTION = 'stats';
const STATS_DOC_ID = 'resumen';

function statsRef(db) {
  return db.collection(STATS_COLLECTION).doc(STATS_DOC_ID);
}

/**
 * Recalcula SOLO los denominadores derivados del padron (total, por local,
 * por mesa) a partir de un escaneo completo de la coleccion padron. Se
 * llama al importar/reimportar el padron (operacion rara y manual) — nunca
 * en el camino caliente de la app.
 */
async function recalcularDenominadoresPadron(db) {
  const padronSnap = await db.collection('padron').get();

  const padronPorLocal = {};
  const padronPorMesa = {};
  padronSnap.forEach((doc) => {
    const p = doc.data();
    padronPorLocal[p.local] = (padronPorLocal[p.local] || 0) + 1;
    const claveMesa = `${p.local} - Mesa ${p.mesa}`;
    padronPorMesa[claveMesa] = (padronPorMesa[claveMesa] || 0) + 1;
  });

  const totalPadron = padronSnap.size;

  await statsRef(db).set({ totalPadron, padronPorLocal, padronPorMesa }, { merge: true });

  return { totalPadron, padronPorLocal, padronPorMesa };
}

/**
 * Recalcula TODO el documento stats/resumen desde cero (padron + registros +
 * votantesConcejal). Es la herramienta de "reset": util para el arranque
 * inicial, o si alguna vez los contadores incrementales quedan
 * desincronizados por algun motivo.
 */
async function recalcularTodoStats(db) {
  const [padronSnap, registrosSnap, votantesConcejalSnap] = await Promise.all([
    db.collection('padron').get(),
    db.collection('registros').get(),
    db.collection('votantesConcejal').get(),
  ]);

  const padronPorLocal = {};
  const padronPorMesa = {};
  padronSnap.forEach((doc) => {
    const p = doc.data();
    padronPorLocal[p.local] = (padronPorLocal[p.local] || 0) + 1;
    const claveMesa = `${p.local} - Mesa ${p.mesa}`;
    padronPorMesa[claveMesa] = (padronPorMesa[claveMesa] || 0) + 1;
  });

  const porLocal = {};
  const porMesa = {};
  const porConcejal = {};
  let totalRegistrados = 0;
  registrosSnap.forEach((doc) => {
    const r = doc.data();
    if (r.estadoGestion !== 'REGISTRADO') return;
    totalRegistrados += 1;
    porLocal[r.local] = (porLocal[r.local] || 0) + 1;
    const claveMesa = `${r.local} - Mesa ${r.mesa}`;
    porMesa[claveMesa] = (porMesa[claveMesa] || 0) + 1;
    if (r.concejalAsignado) {
      porConcejal[r.concejalAsignado] = (porConcejal[r.concejalAsignado] || 0) + 1;
    }
  });

  const conteoPorCedula = {};
  votantesConcejalSnap.forEach((doc) => {
    const v = doc.data();
    conteoPorCedula[v.cedula] = (conteoPorCedula[v.cedula] || 0) + 1;
  });
  const duplicadosEntreListas = Object.values(conteoPorCedula).filter((c) => c > 1).length;

  const resumen = {
    totalPadron: padronSnap.size,
    padronPorLocal,
    padronPorMesa,
    totalRegistrados,
    porLocal,
    porMesa,
    porConcejal,
    duplicadosEntreListas,
    actualizadoEn: admin.firestore.FieldValue.serverTimestamp(),
  };

  await statsRef(db).set(resumen);

  return resumen;
}

module.exports = { statsRef, recalcularDenominadoresPadron, recalcularTodoStats };
