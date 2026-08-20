const express = require('express');
const { login } = require('../lib/auth');

const router = express.Router();

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

module.exports = router;
