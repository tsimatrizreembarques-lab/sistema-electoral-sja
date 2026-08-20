const express = require('express');
const { getFirestore } = require('../lib/firestore');
const { requiereRol } = require('../lib/auth');

const router = express.Router();

/**
 * GET /api/dashboard/admin
 * Vista global: totales por local, por mesa, por concejal, y alertas.
 */
router.get('/admin', requiereRol('admin'), async (req, res) => {
  try {
    const db = getFirestore();

    const [padronSnap, registrosSnap, votantesConcejalSnap] = await Promise.all([
      db.collection('padron').get(),
      db.collection('registros').get(),
      db.collection('votantesConcejal').get(),
    ]);

    const totalPadron = padronSnap.size;

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

    // Duplicados entre listas de concejales (misma cedula en +1 lista).
    const conteoPorCedula = {};
    votantesConcejalSnap.forEach((doc) => {
      const v = doc.data();
      conteoPorCedula[v.cedula] = (conteoPorCedula[v.cedula] || 0) + 1;
    });
    const duplicados = Object.entries(conteoPorCedula).filter(([, count]) => count > 1).length;

    res.json({
      totalPadron,
      totalRegistrados,
      totalPendientes: totalPadron - totalRegistrados,
      porLocal,
      porMesa,
      porConcejal,
      duplicadosEntreListas: duplicados,
    });
  } catch (error) {
    console.error('Error en dashboard admin:', error);
    res.status(500).json({ error: 'Error interno al generar el dashboard.' });
  }
});

/**
 * GET /api/dashboard/concejal
 * Vista individual: solo los votantes donde el concejal quedo como ASIGNADO
 * (el confirmado en comando/mesa, no el simple preasignado que pudo quedar ambiguo),
 * mas los preasignados a el que aun estan PENDIENTES de pasar por algun puesto.
 */
router.get('/concejal', requiereRol('concejal'), async (req, res) => {
  try {
    const nombreConcejal = req.usuario.nombreConcejal;
    if (!nombreConcejal) {
      return res.status(400).json({ error: 'Este usuario no tiene un concejal asociado.' });
    }

    const db = getFirestore();

    const [registradosSnap, preasignadosSnap] = await Promise.all([
      db.collection('registros').where('concejalAsignado', '==', nombreConcejal).get(),
      db.collection('votantesConcejal').where('nombreConcejal', '==', nombreConcejal).get(),
    ]);

    const registrados = registradosSnap.docs.map((d) => d.data());
    const cedulasRegistradas = new Set(registrados.map((r) => r.cedula));
    const caudillosPorCedula = {};
    preasignadosSnap.docs.forEach((d) => {
      caudillosPorCedula[d.data().cedula] = d.data().caudillo || null;
    });
    const registradosConCaudillo = registrados.map((r) => ({ ...r, caudillo: caudillosPorCedula[r.cedula] || null }));

    // Preasignados a este concejal que todavia no tienen ningun registro.
    const pendientes = [];
    for (const doc of preasignadosSnap.docs) {
      const v = doc.data();
      if (!cedulasRegistradas.has(v.cedula)) {
        const padronSnap = await db.collection('padron').doc(v.cedula).get();
        const padron = padronSnap.exists ? padronSnap.data() : {};
        pendientes.push({
          cedula: v.cedula,
          nombresApellidos: padron.nombresApellidos || '(no encontrado en padron)',
          local: padron.local || null,
          mesa: padron.mesa || null,
      caudillo: v.caudillo || null,
          estadoGestion: 'PENDIENTE',
        });
      }
    }

    res.json({
      nombreConcejal,
      totalAsignado: registrados.length + pendientes.length,
      totalRegistrado: registrados.length,
      totalPendiente: pendientes.length,
      votantes: [...registradosConCaudillo, ...pendientes],
    });
  } catch (error) {
    console.error('Error en dashboard concejal:', error);
    res.status(500).json({ error: 'Error interno al generar el dashboard.' });
  }
});

module.exports = router;
