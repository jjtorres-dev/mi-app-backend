const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();


// ============================================================
// CONFIGURACIÓN GENERAL
// ============================================================

const APP_VERSION = '3.0.0';


// ============================================================
// MIDDLEWARES
// ============================================================

app.disable('x-powered-by');

app.use(cors());

app.use(
    express.json({
        limit: '1mb'
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: '1mb'
    })
);


// ============================================================
// RUTAS PRINCIPALES
// ============================================================

app.use(
    '/api/reportes',
    require('./routes/reportes')
);

app.use(
    '/api/alertas',
    require('./routes/alertas')
);

app.use(
    '/api/diagnosticos',
    require('./routes/diagnosticos')
);


// ============================================================
// HEALTH CHECK DEL BACKEND
// ============================================================

app.get('/health', (req, res) => {

    return res.status(200).json({
        status: 'online',
        service: 'moskicheck-backend',
        version: APP_VERSION
    });
});


// ============================================================
// RUTA PRINCIPAL
// ============================================================

app.get('/', (req, res) => {

    return res.status(200).json({
        ok: true,
        mensaje: '🦟 MoskiCheck API funcionando correctamente',
        version: APP_VERSION,

        rutas: [
            'GET  /health',

            'GET  /api/reportes',
            'GET  /api/reportes/por-distrito',
            'GET  /api/reportes/total',
            'POST /api/reportes',

            'GET  /api/alertas/hoy',
            'POST /api/alertas/calcular',

            'POST /api/diagnosticos/analizar'
        ]
    });
});


// ============================================================
// RUTA NO ENCONTRADA
// ============================================================

app.use((req, res) => {

    return res.status(404).json({
        ok: false,
        error: 'Ruta no encontrada.'
    });
});


// ============================================================
// INICIAR SERVIDOR
// ============================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

    console.log('==============================================');
    console.log('🦟 MoskiCheck Backend V3');
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`📦 Versión: ${APP_VERSION}`);
    console.log('==============================================');

    console.log('');
    console.log('📋 Rutas disponibles:');
    console.log(`   GET  http://localhost:${PORT}/health`);

    console.log(`   GET  http://localhost:${PORT}/api/reportes`);
    console.log(`   GET  http://localhost:${PORT}/api/reportes/por-distrito`);
    console.log(`   GET  http://localhost:${PORT}/api/reportes/total`);
    console.log(`   POST http://localhost:${PORT}/api/reportes`);

    console.log(`   GET  http://localhost:${PORT}/api/alertas/hoy`);
    console.log(`   POST http://localhost:${PORT}/api/alertas/calcular`);

    console.log(`   POST http://localhost:${PORT}/api/diagnosticos/analizar`);
    console.log('');
});