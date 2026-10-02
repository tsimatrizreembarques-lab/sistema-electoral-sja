const express = require('express');
const { getFirestore, admin } = require('../lib/firestore');
const { requiereRol } = require('../lib/auth');
const { statsRef } = require('../lib/stats');
const { normalizarCedula } = require('../lib/normalizar');
const { quitarDeLista } = require('../lib/listasConcejal');
const { sincronizarListasConcejalesDebounced, backupRegistro } = require('../lib/sheetsBackup');

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
          telefono: v.telefono || null,
          direccion: v.direccion || null,
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
 * GET /api/dashboard/admin/duplicados
 * Reporte de cedulas que figuran en la lista de 2 o mas concejales, EXCLUSIVO
 * para el admin — los concejales nunca ven esta informacion (ni siquiera que
 * existe un duplicado), solo el admin la puede consultar para resolverlo.
 * Con ?concejal=NOMBRE devuelve solo los duplicados donde ese concejal es uno
 * de los involucrados (con quienes comparte cada cedula).
 */
router.get('/admin/duplicados', requiereRol('admin'), async (req, res) => {
  try {
    const db = getFirestore();
    const filtroConcejal = String(req.query.concejal || '').trim() || null;

    const votantesConcejalSnap = await db.collection('votantesConcejal').get();
    const porCedula = {};
    votantesConcejalSnap.forEach((doc) => {
      const v = doc.data();
      if (!porCedula[v.cedula]) porCedula[v.cedula] = [];
      porCedula[v.cedula].push({ nombreConcejal: v.nombreConcejal, lista: v.lista ?? null, caudillo: v.caudillo || null });
    });

    const entradasDuplicadas = Object.entries(porCedula).filter(
      ([, concejales]) =>
        concejales.length > 1 && (!filtroConcejal || concejales.some((c) => c.nombreConcejal === filtroConcejal))
    );
    const cedulas = entradasDuplicadas.map(([cedula]) => cedula);

    const padronPorCedula = {};
    const registroPorCedula = {};
    const LOTE = 30;
    for (let i = 0; i < cedulas.length; i += LOTE) {
      const lote = cedulas.slice(i, i + LOTE);
      if (lote.length === 0) continue;
      const [padronSnap, registrosSnap] = await Promise.all([
        db.collection('padron').where('cedula', 'in', lote).get(),
        db.collection('registros').where('cedula', 'in', lote).get(),
      ]);
      padronSnap.forEach((d) => { padronPorCedula[d.id] = d.data(); });
      registrosSnap.forEach((d) => { registroPorCedula[d.id] = d.data(); });
    }

    const duplicados = entradasDuplicadas
      .map(([cedula, concejales]) => {
        const padron = padronPorCedula[cedula] || {};
        const registro = registroPorCedula[cedula];
        const registrado = registro?.estadoGestion === 'REGISTRADO';
        return {
          cedula,
          nombresApellidos: padron.nombresApellidos || '',
          local: padron.local || null,
          mesa: padron.mesa ?? null,
          cantidadConcejales: concejales.length,
          concejales: concejales.sort((a, b) => (a.nombreConcejal || '').localeCompare(b.nombreConcejal || '')),
          estadoGestion: registrado ? 'REGISTRADO' : 'PENDIENTE',
          origenRegistro: registrado ? registro.origenRegistro : null,
        };
      })
      .sort((a, b) => b.cantidadConcejales - a.cantidadConcejales || (a.nombresApellidos || '').localeCompare(b.nombresApellidos || ''));

    res.json({
      generadoEn: new Date().toISOString(),
      concejal: filtroConcejal,
      total: duplicados.length,
      duplicados,
    });
  } catch (error) {
    console.error('Error al generar reporte de duplicados:', error);
    res.status(500).json({ error: 'Error interno al generar el reporte.' });
  }
});

/**
 * GET /api/dashboard/admin/preasignados?concejal=NOMBRE&local=LOCAL
 * Cuantas personas cargaron los concejales en sus listas, agrupado por lugar
 * de votacion y por mesa (y cuantas de ellas ya fueron registradas). Ambos
 * filtros son opcionales. Sin filtro de concejal, cada lugar trae ademas el
 * desglose por concejal.
 */
router.get('/admin/preasignados', requiereRol('admin'), async (req, res) => {
  try {
    const db = getFirestore();
    const filtroConcejal = String(req.query.concejal || '').trim() || null;
    const filtroLocal = String(req.query.local || '').trim() || null;

    let query = db.collection('votantesConcejal');
    if (filtroConcejal) query = query.where('nombreConcejal', '==', filtroConcejal);
    const [vcSnap, registrosSnap] = await Promise.all([
      query.get(),
      db.collection('registros').select('cedula', 'estadoGestion').get(),
    ]);

    const votantes = vcSnap.docs.map((d) => d.data());

    // Las altas nuevas ya traen local/mesa; las importadas por Excel no: esas
    // se completan desde el padron, en lotes.
    const sinUbicacion = [...new Set(votantes.filter((v) => !v.local).map((v) => v.cedula))];
    const padronPorCedula = {};
    const LOTE = 30;
    for (let i = 0; i < sinUbicacion.length; i += LOTE) {
      const snap = await db.collection('padron').where('cedula', 'in', sinUbicacion.slice(i, i + LOTE)).get();
      snap.forEach((d) => { padronPorCedula[d.id] = d.data(); });
    }

    const registrados = new Set();
    registrosSnap.forEach((d) => {
      if (d.data().estadoGestion === 'REGISTRADO') registrados.add(d.id);
    });

    const localesDisponibles = new Set();
    const porLocal = {};
    let total = 0;
    let totalRegistrados = 0;

    for (const v of votantes) {
      const local = v.local || padronPorCedula[v.cedula]?.local || 'SIN LUGAR (no está en el padrón)';
      const mesa = v.mesa ?? padronPorCedula[v.cedula]?.mesa ?? null;
      localesDisponibles.add(local);
      if (filtroLocal && local !== filtroLocal) continue;

      const registrado = registrados.has(v.cedula);
      total += 1;
      if (registrado) totalRegistrados += 1;

      if (!porLocal[local]) porLocal[local] = { total: 0, registrados: 0, mesas: {}, concejales: {} };
      const loc = porLocal[local];
      loc.total += 1;
      if (registrado) loc.registrados += 1;

      const claveMesa = mesa ?? '-';
      if (!loc.mesas[claveMesa]) loc.mesas[claveMesa] = { mesa, total: 0, registrados: 0 };
      loc.mesas[claveMesa].total += 1;
      if (registrado) loc.mesas[claveMesa].registrados += 1;

      if (!filtroConcejal) {
        const n = v.nombreConcejal || '(sin concejal)';
        if (!loc.concejales[n]) loc.concejales[n] = { nombreConcejal: n, total: 0, registrados: 0 };
        loc.concejales[n].total += 1;
        if (registrado) loc.concejales[n].registrados += 1;
      }
    }

    const lugares = Object.entries(porLocal)
      .map(([local, loc]) => ({
        local,
        total: loc.total,
        registrados: loc.registrados,
        mesas: Object.values(loc.mesas).sort((a, b) => (Number(a.mesa) || 9999) - (Number(b.mesa) || 9999)),
        concejales: Object.values(loc.concejales).sort((a, b) => b.total - a.total || a.nombreConcejal.localeCompare(b.nombreConcejal)),
      }))
      .sort((a, b) => a.local.localeCompare(b.local));

    res.json({
      generadoEn: new Date().toISOString(),
      concejal: filtroConcejal,
      local: filtroLocal,
      total,
      totalRegistrados,
      lugares,
      localesDisponibles: [...localesDisponibles].sort(),
    });
  } catch (error) {
    console.error('Error al generar reporte de preasignados:', error);
    res.status(500).json({ error: 'Error interno al generar el reporte.' });
  }
});

/**
 * GET /api/dashboard/admin/reporte-concejales?concejal=NOMBRE
 * Reporte por concejal. Sin filtro: una fila por concejal (preasignados,
 * registrados, pendientes, duplicados, asignados en Comando) con su desglose
 * por lugar de votacion. Con ?concejal=: la ficha de ese concejal, con
 * desglose por lugar y mesa y la lista completa de sus votantes.
 */
router.get('/admin/reporte-concejales', requiereRol('admin'), async (req, res) => {
  try {
    const db = getFirestore();
    const filtroConcejal = String(req.query.concejal || '').trim() || null;

    // Se lee la coleccion completa (no solo la del concejal) para poder
    // marcar duplicados contra las listas de los demas.
    const [vcSnap, registrosSnap, concejalesSnap, statsSnap] = await Promise.all([
      db.collection('votantesConcejal').get(),
      db.collection('registros').select('cedula', 'estadoGestion').get(),
      db.collection('concejales').get(),
      statsRef(db).get(),
    ]);

    const todos = vcSnap.docs.map((d) => d.data());
    const listasPorCedula = {};
    todos.forEach((v) => { listasPorCedula[v.cedula] = (listasPorCedula[v.cedula] || 0) + 1; });

    const registrados = new Set();
    registrosSnap.forEach((d) => {
      if (d.data().estadoGestion === 'REGISTRADO') registrados.add(d.id);
    });
    const asignadosEnComando = (statsSnap.exists && statsSnap.data().porConcejal) || {};

    const votantes = filtroConcejal ? todos.filter((v) => v.nombreConcejal === filtroConcejal) : todos;

    // Ubicacion: las altas nuevas la traen; las importadas se completan del padron.
    const sinUbicacion = [...new Set(votantes.filter((v) => !v.local).map((v) => v.cedula))];
    const padronPorCedula = {};
    const LOTE = 30;
    for (let i = 0; i < sinUbicacion.length; i += LOTE) {
      const snap = await db.collection('padron').where('cedula', 'in', sinUbicacion.slice(i, i + LOTE)).get();
      snap.forEach((d) => { padronPorCedula[d.id] = d.data(); });
    }

    // Base: todos los concejales cargados, aunque todavia tengan la lista vacia.
    const porConcejal = {};
    const nuevoConcejal = (nombre, datos = {}) => ({
      nombreConcejal: nombre,
      opcion: datos.opcion ?? null,
      lista: datos.lista ?? null,
      preasignados: 0,
      registrados: 0,
      duplicados: 0,
      asignadosEnComando: asignadosEnComando[nombre] || 0,
      lugares: {},
    });
    concejalesSnap.forEach((d) => {
      if (!filtroConcejal || d.id === filtroConcejal) porConcejal[d.id] = nuevoConcejal(d.id, d.data());
    });

    const detalle = [];
    for (const v of votantes) {
      const n = v.nombreConcejal || '(sin concejal)';
      if (!porConcejal[n]) porConcejal[n] = nuevoConcejal(n);
      const c = porConcejal[n];
      const local = v.local || padronPorCedula[v.cedula]?.local || 'SIN LUGAR (no está en el padrón)';
      const mesa = v.mesa ?? padronPorCedula[v.cedula]?.mesa ?? null;
      const registrado = registrados.has(v.cedula);
      const duplicado = (listasPorCedula[v.cedula] || 0) > 1;

      c.preasignados += 1;
      if (registrado) c.registrados += 1;
      if (duplicado) c.duplicados += 1;

      if (!c.lugares[local]) c.lugares[local] = { local, preasignados: 0, registrados: 0, mesas: {} };
      const l = c.lugares[local];
      l.preasignados += 1;
      if (registrado) l.registrados += 1;
      const claveMesa = mesa ?? '-';
      if (!l.mesas[claveMesa]) l.mesas[claveMesa] = { mesa, preasignados: 0, registrados: 0 };
      l.mesas[claveMesa].preasignados += 1;
      if (registrado) l.mesas[claveMesa].registrados += 1;

      if (filtroConcejal) {
        detalle.push({
          cedula: v.cedula,
          nombresApellidos: v.nombresApellidos || padronPorCedula[v.cedula]?.nombresApellidos || '',
          local,
          mesa,
          caudillo: v.caudillo || null,
          telefono: v.telefono || null,
          direccion: v.direccion || null,
          estadoGestion: registrado ? 'REGISTRADO' : 'PENDIENTE',
          duplicado,
        });
      }
    }

    const concejales = Object.values(porConcejal)
      .map((c) => ({
        ...c,
        pendientes: c.preasignados - c.registrados,
        lugares: Object.values(c.lugares)
          .map((l) => ({
            ...l,
            mesas: Object.values(l.mesas).sort((a, b) => (Number(a.mesa) || 9999) - (Number(b.mesa) || 9999)),
          }))
          .sort((a, b) => a.local.localeCompare(b.local)),
      }))
      .sort((a, b) => (a.opcion ?? 999) - (b.opcion ?? 999) || a.nombreConcejal.localeCompare(b.nombreConcejal));

    detalle.sort((a, b) =>
      a.local.localeCompare(b.local) || (Number(a.mesa) || 9999) - (Number(b.mesa) || 9999) || a.nombresApellidos.localeCompare(b.nombresApellidos)
    );

    res.json({
      generadoEn: new Date().toISOString(),
      concejal: filtroConcejal,
      concejales,
      votantes: filtroConcejal ? detalle : undefined,
    });
  } catch (error) {
    console.error('Error al generar reporte por concejal:', error);
    res.status(500).json({ error: 'Error interno al generar el reporte.' });
  }
});

/**
 * GET /api/dashboard/admin/concejales
 * Concejales disponibles (para el selector del admin), ordenados por opcion.
 */
router.get('/admin/concejales', requiereRol('admin'), async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection('concejales').get();
    const concejales = snap.docs
      .map((d) => ({ nombreConcejal: d.id, lista: d.data().lista ?? null, opcion: d.data().opcion ?? null }))
      .sort((a, b) => (a.opcion ?? 999) - (b.opcion ?? 999) || a.nombreConcejal.localeCompare(b.nombreConcejal));
    res.json({ concejales });
  } catch (error) {
    console.error('Error al listar concejales para admin:', error);
    res.status(500).json({ error: 'Error interno al listar concejales.' });
  }
});

/**
 * GET /api/dashboard/admin/lista?concejal=NOMBRE
 * La lista de UN concejal, para que el admin la revise y pueda borrar
 * entradas. Incluye marca de duplicado (la cedula esta en otra lista).
 */
router.get('/admin/lista', requiereRol('admin'), async (req, res) => {
  try {
    const nombreConcejal = String(req.query.concejal || '').trim();
    if (!nombreConcejal) return res.status(400).json({ error: 'Falta el concejal.' });

    const db = getFirestore();
    const snap = await db.collection('votantesConcejal').where('nombreConcejal', '==', nombreConcejal).get();
    const votantes = snap.docs.map((d) => d.data());
    const cedulas = votantes.map((v) => v.cedula);

    const padronPorCedula = {};
    const registroPorCedula = {};
    const conteoPorCedula = {};
    const LOTE = 30;
    for (let i = 0; i < cedulas.length; i += LOTE) {
      const lote = cedulas.slice(i, i + LOTE);
      const [padronSnap, registrosSnap, vcSnap] = await Promise.all([
        db.collection('padron').where('cedula', 'in', lote).get(),
        db.collection('registros').where('cedula', 'in', lote).select('cedula', 'estadoGestion').get(),
        db.collection('votantesConcejal').where('cedula', 'in', lote).select('cedula').get(),
      ]);
      padronSnap.forEach((d) => { padronPorCedula[d.id] = d.data(); });
      registrosSnap.forEach((d) => { registroPorCedula[d.id] = d.data(); });
      vcSnap.forEach((d) => {
        const c = d.data().cedula;
        conteoPorCedula[c] = (conteoPorCedula[c] || 0) + 1;
      });
    }

    const lista = votantes
      .map((v) => {
        const padron = padronPorCedula[v.cedula] || {};
        return {
          cedula: v.cedula,
          nombresApellidos: v.nombresApellidos || padron.nombresApellidos || '',
          local: padron.local || null,
          mesa: padron.mesa ?? null,
          caudillo: v.caudillo || null,
          telefono: v.telefono || null,
          direccion: v.direccion || null,
          estadoGestion: registroPorCedula[v.cedula]?.estadoGestion === 'REGISTRADO' ? 'REGISTRADO' : 'PENDIENTE',
          duplicado: (conteoPorCedula[v.cedula] || 0) > 1,
        };
      })
      .sort((a, b) => a.nombresApellidos.localeCompare(b.nombresApellidos));

    res.json({ nombreConcejal, total: lista.length, lista });
  } catch (error) {
    console.error('Error al obtener lista de concejal para admin:', error);
    res.status(500).json({ error: 'Error interno al obtener la lista.' });
  }
});

/**
 * DELETE /api/dashboard/admin/lista?concejal=NOMBRE&cedula=123
 * El admin quita una cedula de la lista de cualquier concejal (ej. para
 * resolver un duplicado). A diferencia del concejal, puede hacerlo aunque
 * ya este registrada: el registro de asistencia (coleccion registros) no se
 * toca, solo deja de figurar en esa lista.
 */
router.delete('/admin/lista', requiereRol('admin'), async (req, res) => {
  try {
    const nombreConcejal = String(req.query.concejal || '').trim();
    const cedula = normalizarCedula(req.query.cedula);
    if (!nombreConcejal || !cedula) return res.status(400).json({ error: 'Faltan el concejal o la cedula.' });

    const db = getFirestore();
    const borrado = await quitarDeLista(db, cedula, nombreConcejal);
    if (!borrado) return res.status(404).json({ error: 'Esa cedula no esta en la lista de ese concejal.' });

    sincronizarListasConcejalesDebounced(db);
    res.json({ ok: true });
  } catch (error) {
    console.error('Error al eliminar votante de lista (admin):', error);
    res.status(500).json({ error: 'Error interno al eliminar el votante.' });
  }
});

/**
 * PATCH /api/dashboard/admin/registro/:cedula
 * body: { concejalAsignado }  (null = sin concejal)
 * El admin corrige a que concejal quedo asignado un votante YA registrado
 * (ej. el operador de Comando eligio mal en un duplicado). Ajusta el conteo
 * por concejal y deja el cambio anotado en el historial del registro.
 */
router.patch('/admin/registro/:cedula', requiereRol('admin'), async (req, res) => {
  try {
    const cedula = normalizarCedula(req.params.cedula);
    if (!cedula) return res.status(400).json({ error: 'Cedula invalida.' });
    const concejalNuevo = String(req.body.concejalAsignado || '').trim() || null;

    const db = getFirestore();
    let listaNueva = null;
    if (concejalNuevo) {
      const concejalSnap = await db.collection('concejales').doc(concejalNuevo).get();
      if (!concejalSnap.exists) return res.status(404).json({ error: 'Ese concejal no existe.' });
      listaNueva = concejalSnap.data().lista ?? null;
    }

    const registroRef = db.collection('registros').doc(cedula);
    const resultado = await db.runTransaction(async (tx) => {
      const snap = await tx.get(registroRef);
      if (!snap.exists || snap.data().estadoGestion !== 'REGISTRADO') {
        return { codigo: 404, error: 'Esa cedula todavia no fue registrada.' };
      }
      const concejalAnterior = snap.data().concejalAsignado || null;
      if (concejalAnterior === concejalNuevo) return { sinCambios: true, concejalAnterior };

      const fechaHora = new Date().toISOString();
      const origenRegistro = `Admin (${req.usuario.usuario}): ${concejalAnterior || 'sin concejal'} → ${concejalNuevo || 'sin concejal'}`;
      tx.update(registroRef, {
        concejalAsignado: concejalNuevo,
        listaAsignada: listaNueva,
        historial: admin.firestore.FieldValue.arrayUnion({ tipo: 'CAMBIO_CONCEJAL', origenRegistro, fechaHora }),
      });

      const porConcejal = {};
      if (concejalAnterior) porConcejal[concejalAnterior] = admin.firestore.FieldValue.increment(-1);
      if (concejalNuevo) porConcejal[concejalNuevo] = admin.firestore.FieldValue.increment(1);
      tx.set(statsRef(db), { porConcejal }, { merge: true });

      return {
        concejalAnterior,
        respaldo: { ...snap.data(), concejalAsignado: concejalNuevo, listaAsignada: listaNueva, origenRegistro, fechaHora, tipo: 'CAMBIO_CONCEJAL', dispositivoId: null },
      };
    });

    if (resultado.error) return res.status(resultado.codigo).json({ error: resultado.error });
    // Respaldo en Sheets: nunca bloquea ni hace fallar la correccion.
    if (resultado.respaldo) backupRegistro(resultado.respaldo).catch(() => {});
    res.json({ ok: true, cedula, concejalAnterior: resultado.concejalAnterior, concejalAsignado: concejalNuevo, listaAsignada: listaNueva });
  } catch (error) {
    console.error('Error al corregir concejal de un registro:', error);
    res.status(500).json({ error: 'Error interno al corregir el concejal.' });
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
    const preasignadoPorCedula = {};
    preasignadosSnap.docs.forEach((d) => {
      preasignadoPorCedula[d.data().cedula] = d.data();
    });

    // Nota: si una cedula esta tambien en la lista de OTRO concejal, eso
    // nunca se calcula ni se expone aca — esa visibilidad es exclusiva del
    // admin (reporte de duplicados). El concejal no se entera.
    //
    // Se devuelve SOLO una proyeccion limpia de cada registro: nada de
    // historial, dispositivoId, ni el detalle interno de origen — asi un
    // concejal nunca ve rastro de la actividad de otro concejal sobre una
    // cedula (intentos bloqueados, confirmaciones, dispositivos, etc.).
    const registradosConCaudillo = registrados.map((r) => ({
      cedula: r.cedula,
      nombresApellidos: r.nombresApellidos || null,
      local: r.local || null,
      mesa: r.mesa ?? null,
      caudillo: preasignadoPorCedula[r.cedula]?.caudillo || null,
      telefono: preasignadoPorCedula[r.cedula]?.telefono || null,
      direccion: preasignadoPorCedula[r.cedula]?.direccion || null,
      estadoGestion: 'REGISTRADO',
    }));

    // Preasignados a este concejal que todavia no tienen ningun registro.
    // El padron de cada uno se trae en lotes (no uno por uno), para no hacer
    // N consultas secuenciales a Firestore en un dashboard que se refresca cada 15s.
    const LOTE = 30;
    const cedulasPendientes = preasignadosSnap.docs
      .map((d) => d.data().cedula)
      .filter((c) => !cedulasRegistradas.has(c));

    // Tambien se mira si ya votaron: alguien de esta lista puede haber sido
    // registrado con OTRO concejal asignado (o sin concejal) en Comando. Se
    // muestra como "Votó con otra lista" (o "sin asignar") y NO suma a sus
    // registrados, pero sin decir con quien (eso es solo del admin).
    const padronPorCedula = {};
    const yaVotaron = new Map(); // cedula -> 'OTRA_LISTA' | 'SIN_ASIGNAR'
    for (let i = 0; i < cedulasPendientes.length; i += LOTE) {
      const lote = cedulasPendientes.slice(i, i + LOTE);
      if (lote.length === 0) continue;
      const [padronSnap, registrosSnap] = await Promise.all([
        db.collection('padron').where('cedula', 'in', lote).get(),
        db.collection('registros').where('cedula', 'in', lote).select('cedula', 'estadoGestion', 'concejalAsignado').get(),
      ]);
      padronSnap.forEach((d) => { padronPorCedula[d.id] = d.data(); });
      registrosSnap.forEach((d) => {
        if (d.data().estadoGestion !== 'REGISTRADO') return;
        yaVotaron.set(d.id, d.data().concejalAsignado ? 'OTRA_LISTA' : 'SIN_ASIGNAR');
      });
    }

    const pendientes = [];
    const registradosConOtro = [];
    for (const doc of preasignadosSnap.docs) {
      const v = doc.data();
      if (cedulasRegistradas.has(v.cedula)) continue;
      const padron = padronPorCedula[v.cedula] || {};
      const item = {
        cedula: v.cedula,
        nombresApellidos: padron.nombresApellidos || '(no encontrado en padron)',
        local: padron.local || null,
        mesa: padron.mesa ?? null,
        caudillo: v.caudillo || null,
        telefono: v.telefono || null,
        direccion: v.direccion || null,
        estadoGestion: yaVotaron.get(v.cedula) || 'PENDIENTE',
      };
      (yaVotaron.has(v.cedula) ? registradosConOtro : pendientes).push(item);
    }

    const todosLosVotantes = [...registradosConCaudillo, ...registradosConOtro, ...pendientes];

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
      totalAsignado: todosLosVotantes.length,
      totalRegistrado: registrados.length,
      totalOtraLista: registradosConOtro.filter((v) => v.estadoGestion === 'OTRA_LISTA').length,
      totalSinAsignar: registradosConOtro.filter((v) => v.estadoGestion === 'SIN_ASIGNAR').length,
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
