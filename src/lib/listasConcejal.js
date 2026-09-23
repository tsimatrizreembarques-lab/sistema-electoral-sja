// Operaciones sobre las listas de los concejales (coleccion votantesConcejal)
// compartidas entre las rutas del concejal y las del admin.

const { admin } = require('./firestore');
const { statsRef } = require('./stats');

/**
 * Telefono opcional: deja solo digitos. Devuelve null si viene vacio, o
 * undefined si es invalido (muy corto/largo) para que la ruta responda 400.
 */
function normalizarTelefono(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (!digitos) return null;
  if (digitos.length < 6 || digitos.length > 15) return undefined;
  return digitos;
}

/** Direccion opcional: texto libre recortado, null si viene vacia. */
function normalizarDireccion(valor) {
  const texto = String(valor ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  return texto || null;
}

/**
 * Quita una cedula de la lista de un concejal y mantiene al dia el contador
 * de duplicados del dashboard admin. Devuelve false si no estaba en esa lista.
 */
async function quitarDeLista(db, cedula, nombreConcejal) {
  // Se mira cuantos concejales tenian esta cedula ANTES de eliminar, para
  // saber si esta baja resuelve un duplicado.
  const existentesSnap = await db.collection('votantesConcejal').where('cedula', '==', cedula).get();
  const estaba = existentesSnap.docs.some((d) => d.data().nombreConcejal === nombreConcejal);
  if (!estaba) return false;

  await db.collection('votantesConcejal').doc(`${cedula}__${nombreConcejal}`).delete();

  if (existentesSnap.size === 2) {
    // Habia exactamente 2 (incluyendo este); ahora queda 1: se resuelve el duplicado.
    await statsRef(db).set({ duplicadosEntreListas: admin.firestore.FieldValue.increment(-1) }, { merge: true });
  }
  return true;
}

module.exports = { normalizarTelefono, normalizarDireccion, quitarDeLista };
