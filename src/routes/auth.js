const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { login, requiereRol, hashPassword } = require('../lib/auth');
const { getFirestore } = require('../lib/firestore');

const router = express.Router();

const LARGO_MINIMO = 6;

// Sin caracteres que se confunden al dictarlos o leerlos (0/O, 1/l/I).
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generarPassword(largo = 8) {
  let out = '';
  for (let i = 0; i < largo; i++) out += ALFABETO[crypto.randomInt(ALFABETO.length)];
  return out;
}

router.post('/login', async (req, res) => {
  try {
    const { usuario, password } = req.body;
    if (!usuario || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
    }

    const resultado = await login(usuario, password);
    if (!resultado.ok) {
      return res.status(401).json({ error: resultado.mensaje });
    }

    res.json({ token: resultado.token, perfil: resultado.perfil });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error interno al iniciar sesion.' });
  }
});

/**
 * POST /api/auth/cambiar-password
 * body: { actual, nueva }
 * El concejal cambia su propia contraseña. Se exige la actual para que nadie
 * la pueda cambiar desde un celular que quedo con la sesion abierta.
 */
router.post('/cambiar-password', requiereRol('concejal'), async (req, res) => {
  try {
    const actual = String(req.body.actual || '');
    const nueva = String(req.body.nueva || '');

    if (!actual || !nueva) {
      return res.status(400).json({ error: 'Completá la contraseña actual y la nueva.' });
    }
    if (nueva.length < LARGO_MINIMO) {
      return res.status(400).json({ error: `La contraseña nueva debe tener al menos ${LARGO_MINIMO} caracteres.` });
    }
    if (nueva === actual) {
      return res.status(400).json({ error: 'La contraseña nueva tiene que ser distinta de la actual.' });
    }

    const ref = getFirestore().collection('usuarios').doc(req.usuario.usuario);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }
    if (!(await bcrypt.compare(actual, snap.data().passwordHash))) {
      return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
    }

    await ref.update({ passwordHash: await hashPassword(nueva), passwordCambiadaEn: new Date().toISOString() });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error al cambiar contraseña:', error);
    res.status(500).json({ error: 'Error interno al cambiar la contraseña.' });
  }
});

/**
 * POST /api/auth/resetear-password
 * body: { nombreConcejal }
 * El admin le asigna una contraseña nueva, generada al azar, al usuario de
 * un concejal (ej. si se la olvido). La contraseña se devuelve UNA sola vez
 * para que el admin se la pase; en la base solo queda cifrada.
 */
router.post('/resetear-password', requiereRol('admin'), async (req, res) => {
  try {
    const nombreConcejal = String(req.body.nombreConcejal || '').trim();
    if (!nombreConcejal) return res.status(400).json({ error: 'Falta el concejal.' });

    // Se compara sin distinguir mayusculas ni espacios de sobra, por si el
    // nombre quedo escrito distinto en 'usuarios' que en 'concejales'.
    const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();
    const snap = await getFirestore().collection('usuarios').where('rol', '==', 'concejal').get();
    const usuarios = snap.docs.filter((d) => norm(d.data().nombreConcejal) === norm(nombreConcejal));

    if (usuarios.length === 0) {
      return res.status(404).json({ error: 'Ese concejal no tiene un usuario creado.' });
    }
    if (usuarios.length > 1) {
      return res.status(409).json({
        error: `Ese concejal tiene más de un usuario (${usuarios.map((d) => d.id).join(', ')}). Resetealo desde la computadora.`,
      });
    }

    const password = generarPassword();
    await getFirestore().collection('usuarios').doc(usuarios[0].id).update({
      passwordHash: await hashPassword(password),
      passwordCambiadaEn: new Date().toISOString(),
      passwordReseteadaPor: req.usuario.usuario,
    });

    res.json({ ok: true, usuario: usuarios[0].id, password });
  } catch (error) {
    console.error('Error al resetear contraseña:', error);
    res.status(500).json({ error: 'Error interno al resetear la contraseña.' });
  }
});

module.exports = router;
