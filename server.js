const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const app = express();

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Rutas ─────────────────────────────────────────────────────────────────────
app.use('/api/reportes', require('./routes/reportes'));
app.use('/api/alertas',  require('./routes/alertas'));

// ── Ruta de prueba ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.json({
        ok:      true,
        mensaje: '🦟 MoskiCheck API funcionando correctamente',
        version: '1.0.0',
        rutas: [
            'GET  /api/reportes',
            'GET  /api/reportes/por-distrito',
            'GET  /api/reportes/total',
            'POST /api/reportes',
            'GET  /api/alertas/hoy',
            'POST /api/alertas/calcular'
        ]
    });
});

// ── Iniciar servidor ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 MoskiCheck API corriendo en http://localhost:${PORT}`);
    console.log(`📋 Rutas disponibles:`);
    console.log(`   GET  http://localhost:${PORT}/api/reportes`);
    console.log(`   GET  http://localhost:${PORT}/api/reportes/por-distrito`);
    console.log(`   GET  http://localhost:${PORT}/api/reportes/total`);
    console.log(`   POST http://localhost:${PORT}/api/reportes`);
    console.log(`   GET  http://localhost:${PORT}/api/alertas/hoy`);
    console.log(`   POST http://localhost:${PORT}/api/alertas/calcular`);
});