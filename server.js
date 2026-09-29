const express = require('express');
const cors = require('cors');
require('dotenv').config();
const registrarError = require('./utils/log-error');

const app = express();


// ============================================================
// CONFIGURACIÓN GENERAL
// ============================================================

const APP_VERSION = '3.0.0';


// ============================================================
// MIDDLEWARES
// ============================================================

app.disable('x-powered-by');

app.use((req, res, next) => {
    res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer'
    });
    if (req.path.toLowerCase().startsWith('/api/')) {
        res.set('Cache-Control', 'no-store');
    }
    next();
});

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
        ok: true,
        status: 'online',
        service: 'moskicheck-backend',
        version: APP_VERSION,
        data: {
            status: 'online',
            service: 'moskicheck-backend',
            version: APP_VERSION
        }
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
        data: {
            service: 'moskicheck-backend',
            version: APP_VERSION
        },

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
        mensaje: 'Ruta no encontrada.',
        error: 'Ruta no encontrada.'
    });
});

// Captura también errores del parser, que ocurren antes de entrar a las rutas.
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    let status = 500;
    let mensaje = 'Error interno del servidor';
    if (error.type === 'entity.parse.failed') {
        status = 400;
        mensaje = 'El cuerpo de la solicitud contiene JSON inválido';
    } else if (error.type === 'entity.too.large' || error.type === 'parameters.too.many') {
        status = 413;
        mensaje = 'El cuerpo de la solicitud supera el límite permitido';
    } else if (error.status === 415) {
        status = 415;
        mensaje = 'Codificación del cuerpo de la solicitud no soportada';
    } else if (error.status === 400) {
        status = 400;
        mensaje = 'Solicitud inválida';
    }

    if (status === 500) registrarError('Error no controlado:', error);
    return res.status(status).json({ ok: false, mensaje, error: mensaje });
});


// ============================================================
// INICIAR SERVIDOR
// ============================================================

const PORT = process.env.PORT || 3000;

if (require.main === module) {
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
}

module.exports = app;
