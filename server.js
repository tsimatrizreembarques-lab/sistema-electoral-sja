require('dotenv').config();

const express = require('express');
const path = require('path');

const authRoutes = require('./src/routes/auth');
const votantesRoutes = require('./src/routes/votantes');
const dashboardRoutes = require('./src/routes/dashboard');
const concejalRoutes = require('./src/routes/concejal');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' })); // el sync en lote puede traer varios registros juntos

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

app.get('/health', (req, res) => {
  res.json({ ok: true, mensaje: 'Sistema Electoral SJA activo' });
});

app.use('/api/auth', authRoutes);
app.use('/api/votantes', votantesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/concejal', concejalRoutes);

// Archivos estaticos de la PWA (deben ir DESPUES de las rutas /api).
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Ruta API no encontrada.' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Sistema Electoral SJA iniciado en el puerto ${PORT}`);
});
