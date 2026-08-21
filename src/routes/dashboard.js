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

    // Total del padron por mesa (denominador), para poder mostrar "registrados/total".
    padronSnap.forEach((doc) => {
      const p = doc.data();
      const claveMesa = `${p.local} - Mesa ${p.mesa}`;
      if (!porMesa[claveMesa]) porMesa[claveMesa] = { registrados: 0, total: 0 };
      porMesa[claveMesa].total += 1;
    });

    registrosSnap.forEach((doc) => {
      const r = doc.data();
      if (r.estadoGestion !== 'REGISTRADO') return;
      totalRegistrados += 1;

      porLocal[r.local] = (porLocal[r.local] || 0) + 1;

      const claveMesa = `${r.local} - Mesa ${r.mesa}`;
      if (!porMesa[claveMesa]) porMesa[claveMesa] = { registrados: 0, total: 0 };
      porMesa[claveMesa].registrados += 1;

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
 * GET /api/dashboard/admin/listas
 * Detalle completo (no agregado) de TODAS las listas de TODOS los concejales,
 * para que el admin pueda generar un reporte/PDF. Incluye local/mesa (via
 * padron), estado actual, y marca de duplicado (misma cedula en +1 lista).
 */
router.get('/admin/listas', requiereRol('admin'), async (req, res) => {
  try {
    const db = getFirestore();

    const [votantesConcejalSnap, registrosSnap] = await Promise.all([
      db.collection('votantesConcejal').get(),
      db.collection('registros').select('cedula', 'estadoGestion', 'origenRegistro').get(),
    ]);

    const registroPorCedula = {};
    registrosSnap.forEach((doc) => {
      const r = doc.data();
      registroPorCedula[r.cedula] = r;
    });

    const votantes = votantesConcejalSnap.docs.map((d) => d.data());

    const conteoPorCedula = {};
    votantes.forEach((v) => {
      conteoPorCedula[v.cedula] = (conteoPorCedula[v.cedula] || 0) + 1;
    });

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

    const lista = votantes
      .sort((a, b) => (a.nombreConcejal || '').localeCompare(b.nombreConcejal || '') || String(a.cedula).localeCompare(String(b.cedula)))
      .map((v) => {
        const padron = padronPorCedula[v.cedula] || {};
        const registro = registroPorCedula[v.cedula];
        const registrado = registro?.estadoGestion === 'REGISTRADO';
        return {
          nombreConcejal: v.nombreConcejal,
          lista: v.lista ?? null,
          cedula: v.cedula,
          nombresApellidos: v.nombresApellidos || padron.nombresApellidos || '',
          local: padron.local || null,
          mesa: padron.mesa ?? null,
          caudillo: v.caudillo || null,
          estadoGestion: registrado ? 'REGISTRADO' : 'PENDIENTE',
          origenRegistro: registrado ? registro.origenRegistro : null,
          duplicado: (conteoPorCedula[v.cedula] || 0) > 1,
        };
      });

    const cedulasDuplicadas = new Set(lista.filter((v) => v.duplicado).map((v) => v.cedula)).size;

    res.json({
      generadoEn: new Date().toISOString(),
      total: lista.length,
      duplicados: cedulasDuplicadas,
      lista,
    });
  } catch (error) {
    console.error('Error al generar listado de concejales para admin:', error);
    res.status(500).json({ error: 'Error interno al generar el listado.' });
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

    // Duplicados: cedulas de MI lista que tambien figuran en la lista de otro
    // concejal (se resuelven en comando, pero se muestran como alerta aca).
    const todasMisCedulas = [...new Set([...registrados.map((r) => r.cedula), ...preasignadosSnap.docs.map((d) => d.data().cedula)])];
    const conteoGlobalPorCedula = {};
    const LOTE = 30;
    for (let i = 0; i < todasMisCedulas.length; i += LOTE) {
      const lote = todasMisCedulas.slice(i, i + LOTE);
      if (lote.length === 0) continue;
      const snap = await db.collection('votantesConcejal').where('cedula', 'in', lote).get();
      snap.forEach((d) => {
        const c = d.data().cedula;
        conteoGlobalPorCedula[c] = (conteoGlobalPorCedula[c] || 0) + 1;
      });
    }
    const esDuplicado = (cedula) => (conteoGlobalPorCedula[cedula] || 0) > 1;

    const registradosConCaudillo = registrados.map((r) => ({
      ...r,
      caudillo: caudillosPorCedula[r.cedula] || null,
      duplicado: esDuplicado(r.cedula),
    }));

    // Preasignados a este concejal que todavia no tienen ningun registro.
    // El padron de cada uno se trae en lotes (no uno por uno), para no hacer
    // N consultas secuenciales a Firestore en un dashboard que se refresca cada 15s.
    const cedulasPendientes = preasignadosSnap.docs
      .map((d) => d.data().cedula)
      .filter((c) => !cedulasRegistradas.has(c));

    const padronPorCedula = {};
    for (let i = 0; i < cedulasPendientes.length; i += LOTE) {
      const lote = cedulasPendientes.slice(i, i + LOTE);
      if (lote.length === 0) continue;
      const snap = await db.collection('padron').where('cedula', 'in', lote).get();
      snap.forEach((d) => { padronPorCedula[d.id] = d.data(); });
    }

    const pendientes = [];
    for (const doc of preasignadosSnap.docs) {
      const v = doc.data();
      if (cedulasRegistradas.has(v.cedula)) continue;
      const padron = padronPorCedula[v.cedula] || {};
      pendientes.push({
        cedula: v.cedula,
        nombresApellidos: padron.nombresApellidos || '(no encontrado en padron)',
        local: padron.local || null,
        mesa: padron.mesa || null,
        caudillo: v.caudillo || null,
        estadoGestion: 'PENDIENTE',
        duplicado: esDuplicado(v.cedula),
      });
    }

    const todosLosVotantes = [...registradosConCaudillo, ...pendientes];

    // Desglose por mesa: cuantos de MIS votantes ya votaron vs el total asignado en esa mesa.
    const porMesa = {};
    todosLosVotantes.forEach((v) => {
      if (!v.local || !v.mesa) return;
      const clave = `${v.local} - Mesa ${v.mesa}`;
      if (!porMesa[clave]) porMesa[clave] = { registrados: 0, total: 0 };
      porMesa[clave].total += 1;
      if (v.estadoGestion === 'REGISTRADO') porMesa[clave].registrados += 1;
    });

    res.json({
      nombreConcejal,
      totalAsignado: registrados.length + pendientes.length,
      totalRegistrado: registrados.length,
      totalPendiente: pendientes.length,
      porMesa,
      votantes: todosLosVotantes,
    });
  } catch (error) {
    console.error('Error en dashboard concejal:', error);
    res.status(500).json({ error: 'Error interno al generar el dashboard.' });
  }
});

module.exports = router;
