const express = require('express');
const { getFirestore } = require('../lib/firestore');
const { requiereRol } = require('../lib/auth');
const { statsRef } = require('../lib/stats');

const router = express.Router();

/**
 * GET /api/dashboard/admin
 * Vista global: totales por local, por mesa, por concejal, y alertas.
 * Lee el documento stats/resumen (mantenido al dia por cada registro y cada
 * alta/baja de lista) en vez de escanear padron/registros/votantesConcejal
 * completas — eso evita ~12.000+ lecturas de Firestore en CADA actualizacion
 * del dashboard (se refresca solo cada tantos segundos).
 */
router.get('/admin', requiereRol('admin'), async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await statsRef(db).get();
    const stats = snap.exists ? snap.data() : {};

    const totalPadron = stats.totalPadron || 0;
    const totalRegistrados = stats.totalRegistrados || 0;
    const padronPorMesa = stats.padronPorMesa || {};
    const registradosPorMesa = stats.porMesa || {};

    // Agrupado por escuela: cada mesa es "LOCAL - Mesa N" en stats, asi que
    // se separa en (local, mesa) y se agrupan bajo su escuela — antes se
    // mostraban todas las mesas de todas las escuelas mezcladas en una sola
    // lista plana.
    const porLocal = {};
    new Set([...Object.keys(padronPorMesa), ...Object.keys(registradosPorMesa)]).forEach((clave) => {
      const idx = clave.lastIndexOf(' - Mesa ');
      const local = idx === -1 ? clave : clave.slice(0, idx);
      const mesa = idx === -1 ? null : clave.slice(idx + ' - Mesa '.length);
      const registrados = registradosPorMesa[clave] || 0;
      const total = padronPorMesa[clave] || 0;

      if (!porLocal[local]) porLocal[local] = { registrados: 0, total: 0, mesas: [] };
      porLocal[local].registrados += registrados;
      porLocal[local].total += total;
      porLocal[local].mesas.push({ mesa, registrados, total });
    });
    Object.values(porLocal).forEach((loc) => {
      loc.mesas.sort((a, b) => Number(a.mesa) - Number(b.mesa));
    });

    res.json({
      totalPadron,
      totalRegistrados,
      totalPendientes: totalPadron - totalRegistrados,
      porLocal,
      porConcejal: stats.porConcejal || {},
      duplicadosEntreListas: stats.duplicadosEntreListas || 0,
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

    const [votantesConcejalSnap, registrosSnap, concejalesSnap] = await Promise.all([
      db.collection('votantesConcejal').get(),
      db.collection('registros').select('cedula', 'estadoGestion', 'origenRegistro').get(),
      db.collection('concejales').select('opcion').get(),
    ]);

    const opcionPorConcejal = {};
    concejalesSnap.forEach((doc) => {
      opcionPorConcejal[doc.id] = doc.data().opcion;
    });

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
      .sort((a, b) => {
        const opcionA = opcionPorConcejal[a.nombreConcejal] ?? 999;
        const opcionB = opcionPorConcejal[b.nombreConcejal] ?? 999;
        return opcionA - opcionB || (a.nombreConcejal || '').localeCompare(b.nombreConcejal || '') || String(a.cedula).localeCompare(String(b.cedula));
      })
      .map((v) => {
        const padron = padronPorCedula[v.cedula] || {};
        const registro = registroPorCedula[v.cedula];
        const registrado = registro?.estadoGestion === 'REGISTRADO';
        return {
          opcionConcejal: opcionPorConcejal[v.nombreConcejal] ?? null,
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
