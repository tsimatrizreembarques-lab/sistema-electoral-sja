const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getFirestore } = require('./firestore');

const JWT_SECRET = process.env.JWT_SECRET || 'cambiar-este-secreto-en-produccion';
const JWT_EXPIRES_IN = '18h'; // dura toda una jornada electoral larga

/**
 * Roles del sistema:
 *  - comando   -> ligado a un local (ej. { local: 'ESC.NRO.49' })
 *  - mesa      -> ligado a local + mesa (ej. { local: 'ESC.NRO.49', mesa: 12 })
 *  - concejal  -> ligado a un concejal (ej. { nombreConcejal: 'CARLOS ...' })
 *  - admin     -> acceso global
 */
async function login(usuario, password) {
  const db = getFirestore();
  const snap = await db.collection('usuarios').doc(usuario).get();

  if (!snap.exists) {
    return { ok: false, mensaje: 'Usuario no encontrado.' };
  }

  const data = snap.data();
  const valido = await bcrypt.compare(password, data.passwordHash);

  if (!valido) {
    return { ok: false, mensaje: 'Contraseña incorrecta.' };
  }

  const payload = {
    usuario,
    rol: data.rol,
    local: data.local || null,
    mesa: data.mesa ?? null,
    nombreConcejal: data.nombreConcejal || null,
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  return { ok: true, token, perfil: payload };
}

function verificarToken(token) {
  try {
    return { ok: true, payload: jwt.verify(token, JWT_SECRET) };
  } catch (error) {
    return { ok: false, mensaje: 'Token invalido o expirado.' };
  }
}

/** Middleware Express: exige un token valido y opcionalmente restringe por rol. */
function requiereRol(...rolesPermitidos) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Falta token de autenticacion.' });
    }

    const resultado = verificarToken(token);
    if (!resultado.ok) {
      return res.status(401).json({ error: resultado.mensaje });
    }

    if (rolesPermitidos.length && !rolesPermitidos.includes(resultado.payload.rol)) {
      return res.status(403).json({ error: 'No tenes permiso para esta accion.' });
    }

    req.usuario = resultado.payload;
    next();
  };
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

module.exports = { login, verificarToken, requiereRol, hashPassword, JWT_SECRET };
