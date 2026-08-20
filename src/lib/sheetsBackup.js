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
const SHEET_LISTAS = 'LISTAS_CONCEJALES';
const ENCABEZADOS_LISTAS = ['Concejal', 'Lista', 'Cedula', 'Nombre', 'Local', 'Mesa', 'Caudillo', 'Estado'];

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

const hojasVerificadas = new Set();

/**
 * Crea la pestaña con encabezados si todavia no existe en el spreadsheet.
 * Si ya existe pero el encabezado tiene MENOS columnas que las esperadas
 * (ej. se agrego una columna nueva en una version mas reciente del sistema),
 * lo extiende agregando las que falten al final — nunca reordena ni acorta,
 * para no romper filas historicas que ya estaban escritas.
 */
async function asegurarHoja(sheets, spreadsheetId, nombreHoja, encabezados) {
  if (hojasVerificadas.has(nombreHoja)) return;

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existe = meta.data.sheets.some((s) => s.properties.title === nombreHoja);

  if (!existe) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: nombreHoja } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${nombreHoja}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [encabezados] },
    });
  } else {
    const actual = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${nombreHoja}!1:1` });
    const filaActual = actual.data.values?.[0] || [];
    if (filaActual.length < encabezados.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${nombreHoja}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [encabezados] },
      });
    }
  }

  hojasVerificadas.add(nombreHoja);
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

    await asegurarHoja(sheets, sheetId, SHEET_NAME, [
      'Fecha', 'Cedula', 'Orden', 'Nombre', 'Local', 'Mesa', 'Lista preasignada',
      'Concejal preasignado', 'Lista asignada', 'Concejal asignado', 'Estado', 'Origen', 'Dispositivo', 'Tipo',
    ]);

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
      registro.tipo || 'REGISTRO',
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A1:N1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [fila] },
    });
  } catch (error) {
    // Respaldo best-effort: jamas debe interrumpir el flujo principal.
    console.error('No se pudo escribir el respaldo en Google Sheets:', error.message);
  }
}

/**
 * Reescribe por completo la pestaña LISTAS_CONCEJALES con el estado actual
 * de TODAS las listas de TODOS los concejales (se crea sola si no existe).
 * A diferencia de backupRegistro, esto no es un log incremental: cada
 * llamada reemplaza el contenido entero para que la hoja siempre refleje
 * la foto real y completa de las listas. Nunca bloquea ni hace fallar la
 * operacion que la dispara (alta/baja de un votante en una lista).
 */
async function sincronizarListasConcejales(db) {
  const sheetId = process.env.GOOGLE_SHEET_ID_BACKUP;
  if (!sheetId) return;

  try {
    const sheets = getSheetsClient();
    if (!sheets) return;

    await asegurarHoja(sheets, sheetId, SHEET_LISTAS, ENCABEZADOS_LISTAS);

    const [votantesConcejalSnap, registrosSnap] = await Promise.all([
      db.collection('votantesConcejal').get(),
      db.collection('registros').select('cedula', 'estadoGestion').get(),
    ]);

    const estadoPorCedula = {};
    registrosSnap.forEach((doc) => {
      const r = doc.data();
      estadoPorCedula[r.cedula] = r.estadoGestion;
    });

    const votantes = votantesConcejalSnap.docs.map((d) => d.data());

    // Local/mesa no se guardan en votantesConcejal: se resuelven contra el padron en lotes.
    const cedulasUnicas = [...new Set(votantes.map((v) => v.cedula))];
    const padronPorCedula = {};
    const LOTE = 30;
    for (let i = 0; i < cedulasUnicas.length; i += LOTE) {
      const lote = cedulasUnicas.slice(i, i + LOTE);
      if (lote.length === 0) continue;
      const snap = await db.collection('padron').where('cedula', 'in', lote).get();
      snap.forEach((d) => { padronPorCedula[d.id] = d.data(); });
    }

    const filas = votantes
      .sort((a, b) => (a.nombreConcejal || '').localeCompare(b.nombreConcejal || '') || String(a.cedula).localeCompare(String(b.cedula)))
      .map((v) => {
        const padron = padronPorCedula[v.cedula] || {};
        return [
          v.nombreConcejal || '',
          v.lista ?? '',
          v.cedula || '',
          v.nombresApellidos || padron.nombresApellidos || '',
          padron.local || '',
          padron.mesa ?? '',
          v.caudillo ?? '',
          estadoPorCedula[v.cedula] === 'REGISTRADO' ? 'REGISTRADO' : 'PENDIENTE',
        ];
      });

    await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: `${SHEET_LISTAS}!A2:Z` });

    if (filas.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${SHEET_LISTAS}!A2`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: filas },
      });
    }
  } catch (error) {
    console.error('No se pudo sincronizar LISTAS_CONCEJALES:', error.message);
  }
}

module.exports = { backupRegistro, sincronizarListasConcejales };
