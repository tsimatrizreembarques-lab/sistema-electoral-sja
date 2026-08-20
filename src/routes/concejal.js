const express = require('express');
const { getFirestore } = require('../lib/firestore');
const { requiereRol } = require('../lib/auth');
const { normalizarCedula } = require('../lib/normalizar');
const { sincronizarListasConcejales } = require('../lib/sheetsBackup');

const router = express.Router();

/**
 * GET /api/concejal/buscar/:cedula
 * El concejal escribe una cedula para agregarla a su lista. Devuelve el
 * nombre (tomado del padron) y avisos: si ya esta en su propia lista, o
 * si ya esta en la lista de OTRO concejal (informativo, no bloqueante).
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

    const todasSnap = await db.collection('votantesConcejal').where('cedula', '==', cedula).get();
    const entradas = todasSnap.docs.map((d) => d.data());

    const yaEnMiLista = entradas.some((e) => e.nombreConcejal === nombreConcejal);
    const otrosConcejales = entradas
      .filter((e) => e.nombreConcejal !== nombreConcejal)
      .map((e) => e.nombreConcejal);

    res.json({
      cedula,
      nombresApellidos: padron.nombresApellidos,
      yaEnMiLista,
      otrosConcejales,
    });
  } catch (error) {
    console.error('Error al buscar cedula para concejal:', error);
    res.status(500).json({ error: 'Error interno al buscar la cedula.' });
  }
});

/**
 * POST /api/concejal/agregar
 * body: { cedula, caudillo }
 * Agrega la cedula a la lista del concejal logueado. El caudillo es
 * opcional y puramente informativo (no afecta ninguna otra logica).
 */
router.post('/agregar', requiereRol('concejal'), async (req, res) => {
  try {
    const cedula = normalizarCedula(req.body.cedula);
    const caudillo = (req.body.caudillo || '').trim();
    if (!cedula) return res.status(400).json({ error: 'Cedula invalida.' });

    const db = getFirestore();
    const nombreConcejal = req.usuario.nombreConcejal;

    const padronSnap = await db.collection('padron').doc(cedula).get();
    if (!padronSnap.exists) {
      return res.status(404).json({ error: 'Esa cedula no figura en el padron de SJA.' });
    }
    const padron = padronSnap.data();

    const concejalSnap = await db.collection('concejales').doc(nombreConcejal).get();
    const lista = concejalSnap.exists ? concejalSnap.data().lista : null;

    const ref = db.collection('votantesConcejal').doc(`${cedula}__${nombreConcejal}`);
    await ref.set({
      cedula,
      nombreConcejal,
      lista,
      caudillo: caudillo || null,
      nombresApellidos: padron.nombresApellidos,
    });

    // Respaldo en Sheets: nunca bloquea ni hace fallar el alta principal.
    sincronizarListasConcejales(db).catch(() => {});

    res.status(201).json({ ok: true, cedula, nombresApellidos: padron.nombresApellidos });
  } catch (error) {
    console.error('Error al agregar votante a lista de concejal:', error);
    res.status(500).json({ error: 'Error interno al agregar el votante.' });
  }
});

/**
 * DELETE /api/concejal/eliminar/:cedula
 * Elimina una cedula de la lista del concejal logueado (solo la suya).
 * Si ya fue registrado (paso por comando, mesa, o lo confirmo el propio
 * concejal), ya no se puede eliminar: hay que conservar el rastro.
 */
router.delete('/eliminar/:cedula', requiereRol('concejal'), async (req, res) => {
  try {
    const cedula = normalizarCedula(req.params.cedula);
    const db = getFirestore();
    const nombreConcejal = req.usuario.nombreConcejal;

    const registroSnap = await db.collection('registros').doc(cedula).get();
    if (registroSnap.exists && registroSnap.data().estadoGestion === 'REGISTRADO') {
      return res.status(403).json({ error: 'No se puede eliminar: esta persona ya fue registrada.' });
    }

    await db.collection('votantesConcejal').doc(`${cedula}__${nombreConcejal}`).delete();

    // Respaldo en Sheets: nunca bloquea ni hace fallar la baja principal.
    sincronizarListasConcejales(db).catch(() => {});

    res.json({ ok: true });
  } catch (error) {
    console.error('Error al eliminar votante de lista de concejal:', error);
    res.status(500).json({ error: 'Error interno al eliminar el votante.' });
  }
});

module.exports = router;
