const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { validarReporte } = require('../utils/validation');
const registrarError = require('../utils/log-error');

// ── GET /api/reportes ─────────────────────────────────────────────────────────
// Obtener todos los reportes (para ReportsScreen)
router.get('/', async (req, res) => {
    try {
        const [reportes] = await db.query(`
            SELECT 
                r.id,
                CASE WHEN r.es_anonimo = 1 THEN 'Anónimo' ELSE r.nombre END AS nombre,
                r.distrito,
                r.barrio,
                r.tipo_criadero,
                r.descripcion,
                r.foto_path,
                r.fecha_hora,
                r.es_anonimo,
                r.estado,
                CAST(r.latitude AS DOUBLE) AS latitude,
                CAST(r.longitude AS DOUBLE) AS longitude,
                r.accuracy,
                DATE_FORMAT(r.location_captured_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS locationCapturedAt
            FROM reportes r
            ORDER BY r.fecha_hora DESC
        `);
        res.json({ ok: true, data: reportes });
    } catch (error) {
        registrarError('Error GET /reportes:', error);
        res.status(500).json({ ok: false, mensaje: 'Error al obtener reportes' });
    }
});

// ── GET /api/reportes/por-distrito ────────────────────────────────────────────
// Obtener resumen de reportes agrupados por distrito (para el ranking)
router.get('/por-distrito', async (req, res) => {
    try {
        const [zonas] = await db.query(`
            SELECT 
                distrito,
                COUNT(*) AS total_reportes,
                SUM(CASE WHEN tipo_criadero = 'Recipiente con agua' THEN 1 ELSE 0 END) AS recipiente,
                SUM(CASE WHEN tipo_criadero = 'Llanta/cubierta'     THEN 1 ELSE 0 END) AS llanta,
                SUM(CASE WHEN tipo_criadero = 'Acequia o canal'     THEN 1 ELSE 0 END) AS acequia,
                SUM(CASE WHEN tipo_criadero = 'Maleza o vegetación' THEN 1 ELSE 0 END) AS maleza,
                SUM(CASE WHEN tipo_criadero = 'Depósito de basura'  THEN 1 ELSE 0 END) AS basura
            FROM reportes
            WHERE fecha_hora >= NOW() - INTERVAL 7 DAY
            GROUP BY distrito
            ORDER BY total_reportes DESC
        `);
        res.json({ ok: true, data: zonas });
    } catch (error) {
        registrarError('Error GET /reportes/por-distrito:', error);
        res.status(500).json({ ok: false, mensaje: 'Error al obtener reportes por distrito' });
    }
});

// ── GET /api/reportes/total ───────────────────────────────────────────────────
// Obtener total de reportes y distritos (para los chips del Home)
router.get('/total', async (req, res) => {
    try {
        const [[{ total_reportes }]] = await db.query('SELECT COUNT(*) AS total_reportes FROM reportes');
        const [[{ total_distritos }]] = await db.query('SELECT COUNT(DISTINCT distrito) AS total_distritos FROM reportes');
        res.json({ ok: true, data: { total_reportes, total_distritos } });
    } catch (error) {
        registrarError('Error GET /reportes/total:', error);
        res.status(500).json({ ok: false, mensaje: 'Error al obtener totales' });
    }
});

// ── POST /api/reportes ────────────────────────────────────────────────────────
// Guardar un nuevo reporte desde la app (ReportScreen)
router.post('/', async (req, res) => {
    const validacion = validarReporte(req.body);
    if (validacion.mensaje) {
        return res.status(400).json({ ok: false, mensaje: validacion.mensaje });
    }

    const {
        usuario_id,
        nombre,
        distrito,
        barrio,
        tipo_criadero,
        descripcion,
        foto_path,
        es_anonimo,
        latitude,
        longitude,
        accuracy,
        locationCapturedAt
    } = validacion.reporte;

    try {
        const [result] = await db.execute(`
            INSERT INTO reportes 
                (usuario_id, nombre, distrito, barrio, tipo_criadero, descripcion, foto_path,
                 es_anonimo, latitude, longitude, accuracy, location_captured_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            usuario_id,
            es_anonimo ? 'Anónimo' : (nombre || 'Anónimo'),
            distrito,
            barrio,
            tipo_criadero,
            descripcion,
            foto_path,
            es_anonimo,
            latitude,
            longitude,
            accuracy,
            locationCapturedAt
        ]);

        res.status(201).json({
            ok: true,
            mensaje: 'Reporte guardado correctamente',
            id: result.insertId
        });
    } catch (error) {
        registrarError('Error POST /reportes:', error);
        res.status(500).json({ ok: false, mensaje: 'Error al guardar el reporte' });
    }
});

module.exports = router;
