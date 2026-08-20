// Conexion a Cloud Firestore: es la UNICA fuente de verdad del sistema en vivo.
// Usa el mismo patron de credenciales que sistema-turnos-pro (TSI):
// variable de entorno GOOGLE_SERVICE_ACCOUNT_JSON_CONTENT con el JSON completo
// de la cuenta de servicio (con rol de Firestore habilitado en el proyecto).

const admin = require('firebase-admin');

let app;

function getFirestore() {
  if (!app) {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_CONTENT;
    if (!raw) {
      throw new Error(
        'Falta GOOGLE_SERVICE_ACCOUNT_JSON_CONTENT en las variables de entorno.'
      );
    }
    const credentials = JSON.parse(raw);
    app = admin.initializeApp({
      credential: admin.credential.cert(credentials),
      projectId: credentials.project_id,
    });
  }
  return admin.firestore();
}

module.exports = { getFirestore, admin };
