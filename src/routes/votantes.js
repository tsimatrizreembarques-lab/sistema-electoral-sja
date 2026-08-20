const express = require('express');
const { getFirestore, admin } = require('../lib/firestore');
const { requiereRol } = require('../lib/auth');
const { normalizarCedula } = require('../lib/normalizar');
const { backupRegistro } = require('../lib/sheetsBackup');

const router = express.Router();

/**
 * GET /api/votantes/:cedula
 * Usado por Comando y Mesa para buscar a un votante.
 * Devuelve: datos del padron, preasignaciones (puede haber mas de una = duplicado real),
 * y el estado de registro actual si ya existe.
 */
router.get('/:cedula', requiereRol('comando', 'mesa', 'admin'), async (req, res) => {
  try {
    const cedula = normalizarCedula(req.params.cedula);
    if (!cedula) {
      return res.status(400).json({ error: 'Cedula invalida.' });
    }

    const db = getFirestore();

    const padronSnap = await db.collection('padron').doc(cedula).get();
    if (!padronSnap.exists) {
      return res.status(404).json({ error: 'Cedula no encontrada en el padron.' });
    }
    const padron = padronSnap.data();

    // Preasignaciones: puede haber 0, 1 o mas de un concejal (caso real de duplicado).
    const preasignadosSnap = await db
      .collection('votantesConcejal')
      .where('cedula', '==', cedula)
      .get();
    const preasignados = preasignadosSnap.docs.map((d) => d.data());

    // Estado de registro actual (si ya fue marcado desde comando o mesa).
    const registroSnap = await db.collection('registros').doc(cedula).get();
    const registroActual = registroSnap.exists ? registroSnap.data() : null;

    res.json({
      cedula,
      nombresApellidos: padron.nombresApellidos,
      local: padron.local,
      mesa: padron.mesa,
      orden: padron.orden,
      preasignados, // [] si no fue cargado por ningun concejal; >1 si hay duplicado real
      duplicadoAmbiguo: preasignados.length > 1,
      registroActual,
    });
  } catch (error) {
    console.error('Error al buscar votante:', error);
    res.status(500).json({ error: 'Error interno al buscar el votante.' });
  }
});

/**
 * Registra (o actualiza, si forzar=true) el paso de un votante por comando o mesa.
 * Un unico estado por votante: PENDIENTE -> REGISTRADO, sin importar cual de los
 * dos puestos lo marque. Si ya estaba REGISTRADO y no se fuerza, devuelve conflicto.
 */
async function registrarVotante({ usuario, cedula, listaAsignada, concejalAsignado, dispositivoId, forzar, fechaHoraCliente }) {
  const db = getFirestore();
  const cedulaNorm = normalizarCedula(cedula);

  const padronSnap = await db.collection('padron').doc(cedulaNorm).get();
  if (!padronSnap.exists) {
    return { ok: false, codigo: 404, mensaje: 'Cedula no encontrada en el padron.' };
  }
  const padron = padronSnap.data();

  const registroRef = db.collection('registros').doc(cedulaNorm);
  const registroSnap = await registroRef.get();

  if (registroSnap.exists && registroSnap.data().estadoGestion === 'REGISTRADO' && !forzar) {
    const existente = registroSnap.data();
    return {
      ok: false,
      codigo: 409,
      mensaje: `Ya fue registrado por ${existente.origenRegistro} a las ${existente.fechaHora}.`,
      registroExistente: existente,
    };
  }

  // Preasignados, para dejar historial de con que concejal(es) habia llegado cargado.
  const preasignadosSnap = await db
    .collection('votantesConcejal')
    .where('cedula', '==', cedulaNorm)
    .get();
  const preasignados = preasignadosSnap.docs.map((d) => d.data());

  const origenRegistro =
    usuario.rol === 'comando'
      ? `Registrado en Puesto Comando (${usuario.local})`
      : `Registrado como Veedor Mesa ${usuario.mesa} — ${usuario.local}`;

  const registro = {
    cedula: cedulaNorm,
    orden: padron.orden ?? null,
    nombresApellidos: padron.nombresApellidos,
    local: padron.local,
    mesa: padron.mesa,
    listaPreasignada: preasignados[0]?.lista ?? null,
    concejalPreasignado: preasignados.map((p) => p.nombreConcejal).join(' / ') || null,
    listaAsignada: listaAsignada ?? preasignados[0]?.lista ?? null,
    concejalAsignado: concejalAsignado ?? preasignados[0]?.nombreConcejal ?? null,
    estadoGestion: 'REGISTRADO',
    origenRegistro,
    fechaHora: fechaHoraCliente || new Date().toISOString(),
    fechaHoraServidor: admin.firestore.FieldValue.serverTimestamp(),
    dispositivoId: dispositivoId || null,
  };

  await registroRef.set(registro, { merge: true });

  // Respaldo en Google Sheets: nunca bloquea ni hace fallar el registro principal.
  backupRegistro(registro).catch(() => {});

  return { ok: true, registro };
}

/**
 * POST /api/votantes/registrar
 * Registro individual (uso normal con conexion).
 */
router.post('/registrar', requiereRol('comando', 'mesa'), async (req, res) => {
  try {
    const resultado = await registrarVotante({
      usuario: req.usuario,
      cedula: req.body.cedula,
      listaAsignada: req.body.listaAsignada,
      concejalAsignado: req.body.concejalAsignado,
      dispositivoId: req.body.dispositivoId,
      forzar: Boolean(req.body.forzar),
      fechaHoraCliente: req.body.fechaHora,
    });

    if (!resultado.ok) {
      return res.status(resultado.codigo).json(resultado);
    }
    res.status(201).json(resultado);
  } catch (error) {
    console.error('Error al registrar votante:', error);
    res.status(500).json({ error: 'Error interno al registrar.' });
  }
});

/**
 * POST /api/votantes/sync
 * Sincronizacion en lote de la cola offline de un dispositivo.
 * body: { registros: [ { idLocal, cedula, listaAsignada, concejalAsignado, fechaHora, forzar }, ... ] }
 * Cada item se procesa de forma independiente; se devuelve el resultado de cada uno
 * (exito o conflicto) identificado por su idLocal, para que la app borre de la cola
 * solo lo que se confirmo.
 */
router.post('/sync', requiereRol('comando', 'mesa'), async (req, res) => {
  const items = Array.isArray(req.body.registros) ? req.body.registros : [];
  const resultados = [];

  for (const item of items) {
    try {
      const resultado = await registrarVotante({
        usuario: req.usuario,
        cedula: item.cedula,
        listaAsignada: item.listaAsignada,
        concejalAsignado: item.concejalAsignado,
        dispositivoId: item.dispositivoId,
        forzar: Boolean(item.forzar),
        fechaHoraCliente: item.fechaHora,
      });
      resultados.push({ idLocal: item.idLocal, ...resultado });
    } catch (error) {
      resultados.push({ idLocal: item.idLocal, ok: false, codigo: 500, mensaje: error.message });
    }
  }

  res.json({ resultados });
});

/**
 * GET /api/votantes/paquete-local
 * Usado por Comando y Mesa para descargar, mientras HAY señal, todo lo que
 * van a necesitar para operar offline: el padron de su local (o de su mesa,
 * si el rol es mesa), las preasignaciones de concejales para esas cedulas,
 * y el estado de registro que ya existiera para ellas.
 */
router.get('/paquete-local/descargar', requiereRol('comando', 'mesa'), async (req, res) => {
  try {
    const db = getFirestore();
    const { local, mesa, rol } = req.usuario;

    let padronQuery = db.collection('padron').where('local', '==', local);
    if (rol === 'mesa') {
      padronQuery = padronQuery.where('mesa', '==', mesa);
    }
    const padronSnap = await padronQuery.get();
    const padron = padronSnap.docs.map((d) => d.data());
    const cedulas = padron.map((p) => p.cedula);

    // Firestore 'in' admite hasta 30 valores por consulta; se hace en lotes.
    const votantesConcejal = [];
    const registros = [];
    const LOTE = 30;
    for (let i = 0; i < cedulas.length; i += LOTE) {
      const lote = cedulas.slice(i, i + LOTE);
      if (lote.length === 0) continue;

      const [vcSnap, regSnap] = await Promise.all([
        db.collection('votantesConcejal').where('cedula', 'in', lote).get(),
        db.collection('registros').where('cedula', 'in', lote).get(),
      ]);
      vcSnap.forEach((d) => votantesConcejal.push(d.data()));
      regSnap.forEach((d) => registros.push(d.data()));
    }

    res.json({
      generadoEn: new Date().toISOString(),
      local,
      mesa: mesa ?? null,
      padron,
      votantesConcejal,
      registros,
    });
  } catch (error) {
    console.error('Error al generar paquete local:', error);
    res.status(500).json({ error: 'Error interno al generar el paquete de datos.' });
  }
});

module.exports = router;
