// Respaldo en Google Sheets: copia paralela de cada registro confirmado.
// IMPORTANTE: nunca debe bloquear ni frenar el registro de un votante.
// Si falla (cuota, red, etc.) solo se loguea el error y se sigue de largo;
// la fuente de verdad del sistema en vivo es siempre Firestore.

const { google } = require('googleapis');

let sheetsClient = null;

function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_CONTENT;
  if (!raw) return null;

  const credentials = JSON.parse(raw);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

const SHEET_NAME = 'REGISTROS';

/** Formatea una fecha (ISO UTC o Date) a hora local de Paraguay, legible. */
function formatearFechaPY(valor) {
  try {
    const fecha = valor ? new Date(valor) : new Date();
    return fecha.toLocaleString('es-PY', {
      timeZone: 'America/Asuncion',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  } catch (e) {
    return String(valor || '');
  }
}

/**
 * Agrega una fila con el registro al Google Sheet de respaldo.
 * Nunca lanza excepcion hacia arriba: solo loguea si algo falla.
 */
async function backupRegistro(registro) {
  const sheetId = process.env.GOOGLE_SHEET_ID_BACKUP;
  if (!sheetId) {
    console.warn('GOOGLE_SHEET_ID_BACKUP no configurado; se omite respaldo en Sheets.');
    return;
  }

  try {
    const sheets = getSheetsClient();
    if (!sheets) return;

    const fila = [
      formatearFechaPY(registro.fechaHora),
      registro.cedula || '',
      registro.orden ?? '',
      registro.nombresApellidos || '',
      registro.local || '',
      registro.mesa || '',
      registro.listaPreasignada ?? '',
      registro.concejalPreasignado ?? '',
      registro.listaAsignada ?? '',
      registro.concejalAsignado ?? '',
      registro.estadoGestion || '',
      registro.origenRegistro || '',
      registro.dispositivoId || '',
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A1:M1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [fila] },
    });
  } catch (error) {
    // Respaldo best-effort: jamas debe interrumpir el flujo principal.
    console.error('No se pudo escribir el respaldo en Google Sheets:', error.message);
  }
}

module.exports = { backupRegistro };
