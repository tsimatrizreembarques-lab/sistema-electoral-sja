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

/** Describe desde donde se esta intentando registrar, para mensajes e historial. */
function describirOrigen(usuario) {
  if (usuario.rol === 'comando') return `Puesto Comando (${usuario.local})`;
  if (usuario.rol === 'concejal') return `el concejal ${usuario.nombreConcejal}`;
  return `Mesa ${usuario.mesa} — ${usuario.local}`;
}

/**
 * Registra (o actualiza, si forzar=true) el paso de un votante por comando,
 * mesa o concejal. Un unico estado por votante: PENDIENTE -> REGISTRADO, sin
 * importar cual de los tres lo marque. Si ya estaba REGISTRADO y no se fuerza,
 * devuelve conflicto — pero igual queda una traza del intento (historial +
 * Sheets), para que se sepa que alguien mas tambien intento marcarlo.
 */
async function registrarVotante({ usuario, cedula, listaAsignada, concejalAsignado, dispositivoId, forzar, fechaHoraCliente }) {
  const db = getFirestore();
  const cedulaNorm = normalizarCedula(cedula);

  const padronSnap = await db.collection('padron').doc(cedulaNorm).get();
  if (!padronSnap.exists) {
    return { ok: false, codigo: 404, mensaje: 'Cedula no encontrada en el padron.' };
  }
  const padron = padronSnap.data();

  // Preasignados: hacen falta ANTES de tocar el registro, tanto para el chequeo
  // de pertenencia del concejal como para completar lista/concejal asignados.
  const preasignadosSnap = await db
    .collection('votantesConcejal')
    .where('cedula', '==', cedulaNorm)
    .get();
  const preasignados = preasignadosSnap.docs.map((d) => d.data());

  let listaFinal = listaAsignada ?? preasignados[0]?.lista ?? null;
  let concejalFinal = concejalAsignado ?? preasignados[0]?.nombreConcejal ?? null;
  let forzarFinal = Boolean(forzar);

  if (usuario.rol === 'concejal') {
    // El concejal solo puede confirmar votantes de su propia lista (nunca a
    // nombre de otro, y nunca sobreescribir un registro ya hecho por comando
    // o mesa) — se corta aca, ANTES de tocar el registro, para que un concejal
    // no pueda usar esta ruta para averiguar el estado de cedulas ajenas.
    const propio = preasignados.find((p) => p.nombreConcejal === usuario.nombreConcejal);
    if (!propio) {
      return { ok: false, codigo: 403, mensaje: 'Esa cedula no esta en tu lista.' };
    }
    listaFinal = propio.lista ?? null;
    concejalFinal = usuario.nombreConcejal;
    forzarFinal = false;
  }

  const registroRef = db.collection('registros').doc(cedulaNorm);

  // Leer+decidir+escribir en una transaccion: evita que dos dispositivos que
  // registran la MISMA cedula casi al mismo tiempo se pisen sin que ninguno
  // detecte el conflicto (ambos verian "no registrado" si se leyera afuera).
  const resultado = await db.runTransaction(async (tx) => {
    const registroSnap = await tx.get(registroRef);
    const yaEstabaRegistrado = registroSnap.exists && registroSnap.data().estadoGestion === 'REGISTRADO';

    if (yaEstabaRegistrado && !forzarFinal) {
      return { bloqueado: true, existente: registroSnap.data() };
    }

    const origenRegistro =
      usuario.rol === 'comando'
        ? `Registrado en Puesto Comando (${usuario.local})`
        : usuario.rol === 'concejal'
        ? `Confirmado por el concejal ${usuario.nombreConcejal} (reporte manual)`
        : `Registrado como Veedor Mesa ${usuario.mesa} — ${usuario.local}`;

    const tipo = yaEstabaRegistrado ? 'FORZADO' : 'REGISTRO';
    const fechaHora = fechaHoraCliente || new Date().toISOString();

    const registro = {
      cedula: cedulaNorm,
      orden: padron.orden ?? null,
      nombresApellidos: padron.nombresApellidos,
      local: padron.local,
      mesa: padron.mesa,
      listaPreasignada: preasignados[0]?.lista ?? null,
      concejalPreasignado: preasignados.map((p) => p.nombreConcejal).join(' / ') || null,
      listaAsignada: listaFinal,
      concejalAsignado: concejalFinal,
      estadoGestion: 'REGISTRADO',
      origenRegistro,
      tipo,
      fechaHora,
      fechaHoraServidor: admin.firestore.FieldValue.serverTimestamp(),
      dispositivoId: dispositivoId || null,
    };

    tx.set(
      registroRef,
      {
        ...registro,
        historial: admin.firestore.FieldValue.arrayUnion({ tipo, origenRegistro, fechaHora, dispositivoId: dispositivoId || null }),
      },
      { merge: true }
    );

    return { bloqueado: false, registro };
  });

  if (resultado.bloqueado) {
    const existente = resultado.existente;
    const fechaIntento = new Date().toISOString();
    const origenIntento = describirOrigen(usuario);

    await registroRef.update({
      historial: admin.firestore.FieldValue.arrayUnion({
        tipo: 'INTENTO_BLOQUEADO',
        origenIntento,
        fechaHora: fechaIntento,
        dispositivoId: dispositivoId || null,
      }),
    });

    // Traza en Sheets del intento bloqueado: nunca bloquea ni hace fallar la respuesta.
    backupRegistro({
      cedula: cedulaNorm,
      nombresApellidos: existente.nombresApellidos,
      local: existente.local,
      mesa: existente.mesa,
      listaAsignada: existente.listaAsignada,
      concejalAsignado: existente.concejalAsignado,
      estadoGestion: 'INTENTO_BLOQUEADO',
      origenRegistro: `Intento desde ${origenIntento} — ya estaba registrado por ${existente.origenRegistro}`,
      fechaHora: fechaIntento,
      dispositivoId,
      tipo: 'INTENTO_BLOQUEADO',
    }).catch(() => {});

    return {
      ok: false,
      codigo: 409,
      mensaje: `Ya fue registrado por ${existente.origenRegistro} a las ${existente.fechaHora}.`,
      registroExistente: existente,
    };
  }

  // Respaldo en Google Sheets: nunca bloquea ni hace fallar el registro principal.
  backupRegistro(resultado.registro).catch(() => {});

  return { ok: true, registro: resultado.registro };
}

/**
 * POST /api/votantes/registrar
 * Registro individual (uso normal con conexion). El concejal tambien puede
 * usar esta ruta para confirmar, desde su propia lista, que alguien ya paso
 * por comando o mesa (reporte manual, ej. porque el votante lo aviso).
 */
router.post('/registrar', requiereRol('comando', 'mesa', 'concejal'), async (req, res) => {
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
