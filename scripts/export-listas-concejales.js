// Uso: node scripts/export-listas-concejales.js
// Reescribe por completo la pestaña LISTAS_CONCEJALES del Google Sheet de
// respaldo (GOOGLE_SHEET_ID_BACKUP) con el estado actual de TODAS las listas
// de TODOS los concejales. La pestaña se crea sola si todavia no existe.
// Se puede correr en cualquier momento para tener una foto actualizada
// (la app tambien la actualiza sola cada vez que un concejal agrega o
// elimina a alguien de su lista).

require('dotenv').config();
const { getFirestore } = require('../src/lib/firestore');
const { sincronizarListasConcejales } = require('../src/lib/sheetsBackup');

async function main() {
  if (!process.env.GOOGLE_SHEET_ID_BACKUP) {
    console.error('Falta GOOGLE_SHEET_ID_BACKUP en las variables de entorno.');
    process.exit(1);
  }

  const db = getFirestore();
  await sincronizarListasConcejales(db);
  console.log('Pestaña LISTAS_CONCEJALES actualizada.');
  process.exit(0);
}

main().catch((error) => {
  console.error('Error al exportar las listas de concejales:', error);
  process.exit(1);
});
