const express = require('express');
const { getFirestore, admin } = require('../lib/firestore');
const { requiereRol } = require('../lib/auth');
const { normalizarCedula } = require('../lib/normalizar');
const { sincronizarListasConcejalesDebounced } = require('../lib/sheetsBackup');
const { statsRef } = require('../lib/stats');
const { normalizarTelefono, normalizarDireccion, quitarDeLista } = require('../lib/listasConcejal');

const router = express.Router();

/**
 * GET /api/concejal/buscar/:cedula
 * El concejal escribe una cedula para agregarla a su lista. Devuelve el
 * nombre (tomado del padron) y si ya esta en su propia lista o ya fue
 * registrada. NUNCA informa si la cedula esta tambien en la lista de OTRO
 * concejal — esa visibilidad es exclusiva del admin (reporte de duplicados).
 */
router.get('/buscar/:cedula', requiereRol('concejal'), async (req, res) => {
  try {
    const cedula = normalizarCedula(req.params.cedula);
    if (!cedula) return res.status(400).json({ error: 'Cedula invalida.' });

    const db = getFirestore();
    const nombreConcejal = req.usuario.nombreConcejal;

    const padronSnap = await db.collection('padron').doc(cedula).get();
    if (!padronSnap.exists) {
      return res.status(404).json({ error: 'Esa cedula no figura en el padron de SJA.' });
    }
    const padron = padronSnap.data();

    const propioSnap = await db.collection('votantesConcejal').doc(`${cedula}__${nombreConcejal}`).get();
    const yaEnMiLista = propioSnap.exists;

    const registroSnap = await db.collection('registros').doc(cedula).get();
    const yaRegistrado = registroSnap.exists && registroSnap.data().estadoGestion === 'REGISTRADO';

    // Solo el booleano yaRegistrado: no se expone origenRegistro ni ningun
    // otro detalle, para que el concejal nunca vea rastro de que hizo otro
    // concejal (ni de que puesto/dispositivo) sobre esa cedula.
    res.json({
      cedula,
      nombresApellidos: padron.nombresApellidos,
      yaEnMiLista,
      yaRegistrado,
    });
  } catch (error) {
    console.error('Error al buscar cedula para concejal:', error);
    res.status(500).json({ error: 'Error interno al buscar la cedula.' });
  }
});

/**
 * POST /api/concejal/agregar
 * body: { cedula, caudillo, telefono, direccion }
 * Agrega la cedula a la lista del concejal logueado. Caudillo, telefono y
 * direccion son opcionales y puramente informativos (no afectan ninguna
 * otra logica).
 */
router.post('/agregar', requiereRol('concejal'), async (req, res) => {
  try {
    const cedula = normalizarCedula(req.body.cedula);
    const caudillo = String(req.body.caudillo || '').trim();
    const telefono = normalizarTelefono(req.body.telefono);
    const direccion = normalizarDireccion(req.body.direccion);
    if (!cedula) return res.status(400).json({ error: 'Cedula invalida.' });
    if (telefono === undefined) return res.status(400).json({ error: 'Numero de telefono invalido.' });

    const db = getFirestore();
    const nombreConcejal = req.usuario.nombreConcejal;
    if (!nombreConcejal) return res.status(400).json({ error: 'Este usuario no tiene un concejal asociado.' });

    const padronSnap = await db.collection('padron').doc(cedula).get();
    if (!padronSnap.exists) {
      return res.status(404).json({ error: 'Esa cedula no figura en el padron de SJA.' });
    }
    const padron = padronSnap.data();

    const registroSnap = await db.collection('registros').doc(cedula).get();
    if (registroSnap.exists && registroSnap.data().estadoGestion === 'REGISTRADO') {
      return res.status(403).json({
        error: 'No se puede agregar: esta persona ya fue registrada.',
      });
    }

    const concejalSnap = await db.collection('concejales').doc(nombreConcejal).get();
    const lista = concejalSnap.exists ? concejalSnap.data().lista : null;

    // Se mira cuantos concejales tenian esta cedula ANTES de agregar, para
    // saber si esta alta crea un duplicado nuevo (contador del dashboard admin).
    const existentesSnap = await db.collection('votantesConcejal').where('cedula', '==', cedula).get();
    const yaTeniaEsteConcejal = existentesSnap.docs.some((d) => d.data().nombreConcejal === nombreConcejal);

    const ref = db.collection('votantesConcejal').doc(`${cedula}__${nombreConcejal}`);
    await ref.set({
      cedula,
      nombreConcejal,
      lista,
      caudillo: caudillo || null,
      telefono,
      direccion,
      nombresApellidos: padron.nombresApellidos,
    });

    if (!yaTeniaEsteConcejal && existentesSnap.size === 1) {
      // Antes habia exactamente otro concejal; con este ya son 2: duplicado nuevo.
      await statsRef(db).set({ duplicadosEntreListas: admin.firestore.FieldValue.increment(1) }, { merge: true });
    }

    // Respaldo en Sheets: nunca bloquea ni hace fallar el alta principal.
    sincronizarListasConcejalesDebounced(db);

    res.status(201).json({ ok: true, cedula, nombresApellidos: padron.nombresApellidos });
  } catch (error) {
    console.error('Error al agregar votante a lista de concejal:', error);
    res.status(500).json({ error: 'Error interno al agregar el votante.' });
  }
});

/**
 * PATCH /api/concejal/contacto/:cedula
 * body: { telefono, direccion }
 * Edita el telefono y la direccion (ambos opcionales) de una persona que ya
 * esta en la lista del concejal logueado. Se permite aunque ya haya sido
 * registrada: son datos de contacto, no tocan la trazabilidad.
 */
router.patch('/contacto/:cedula', requiereRol('concejal'), async (req, res) => {
  try {
    const cedula = normalizarCedula(req.params.cedula);
    const telefono = normalizarTelefono(req.body.telefono);
    const direccion = normalizarDireccion(req.body.direccion);
    if (!cedula) return res.status(400).json({ error: 'Cedula invalida.' });
    if (telefono === undefined) return res.status(400).json({ error: 'Numero de telefono invalido.' });

    const db = getFirestore();
    const ref = db.collection('votantesConcejal').doc(`${cedula}__${req.usuario.nombreConcejal}`);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Esa persona no esta en tu lista.' });
    }

    await ref.update({ telefono, direccion });
    sincronizarListasConcejalesDebounced(db);

    res.json({ ok: true, telefono, direccion });
  } catch (error) {
    console.error('Error al editar contacto de votante:', error);
    res.status(500).json({ error: 'Error interno al guardar el contacto.' });
  }
});

/**
 * DELETE /api/concejal/eliminar/:cedula
 * Elimina una cedula de la lista del concejal logueado (solo la suya).
 * Si ya fue registrado (paso por comando o mesa), ya no se puede eliminar:
 * hay que conservar el rastro. El admin si puede (ver dashboard.js).
 */
router.delete('/eliminar/:cedula', requiereRol('concejal'), async (req, res) => {
  try {
    const cedula = normalizarCedula(req.params.cedula);
    if (!cedula) return res.status(400).json({ error: 'Cedula invalida.' });
    const db = getFirestore();
    const nombreConcejal = req.usuario.nombreConcejal;

    const registroSnap = await db.collection('registros').doc(cedula).get();
    if (registroSnap.exists && registroSnap.data().estadoGestion === 'REGISTRADO') {
      return res.status(403).json({ error: 'No se puede eliminar: esta persona ya fue registrada.' });
    }

    await quitarDeLista(db, cedula, nombreConcejal);

    // Respaldo en Sheets: nunca bloquea ni hace fallar la baja principal.
    sincronizarListasConcejalesDebounced(db);

    res.json({ ok: true });
  } catch (error) {
    console.error('Error al eliminar votante de lista de concejal:', error);
    res.status(500).json({ error: 'Error interno al eliminar el votante.' });
  }
});

module.exports = router;
