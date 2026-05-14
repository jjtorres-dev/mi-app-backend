const express = require('express');
const router  = express.Router();
const db      = require('../db');

// ── GET /api/reportes ─────────────────────────────────────────────────────────
// Obtener todos los reportes (para ReportsScreen)
router.get('/', async (req, res) => {
    try {
        const [reportes] = await db.query(`
            SELECT 
                r.id,
                r.nombre,
                r.distrito,
                r.barrio,
                r.tipo_criadero,
                r.descripcion,
                r.foto_path,
                r.fecha_hora,
                r.es_anonimo,
                r.estado,
                u.nombre    AS usuario_nombre,
                u.apellidos AS usuario_apellidos
            FROM reportes r
            LEFT JOIN usuarios u ON r.usuario_id = u.id
            ORDER BY r.fecha_hora DESC
        `);
        res.json({ ok: true, data: reportes });
    } catch (error) {
        console.error('Error GET /reportes:', error);
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
        console.error('Error GET /reportes/por-distrito:', error);
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
        console.error('Error GET /reportes/total:', error);
        res.status(500).json({ ok: false, mensaje: 'Error al obtener totales' });
    }
});

// ── POST /api/reportes ────────────────────────────────────────────────────────
// Guardar un nuevo reporte desde la app (ReportScreen)
router.post('/', async (req, res) => {
    const {
        usuario_id,
        nombre,
        distrito,
        barrio,
        tipo_criadero,
        descripcion,
        foto_path,
        es_anonimo
    } = req.body;

    // Validación básica
    if (!distrito || !tipo_criadero) {
        return res.status(400).json({
            ok: false,
            mensaje: 'Distrito y tipo de criadero son obligatorios'
        });
    }

    try {
        const [result] = await db.query(`
            INSERT INTO reportes 
                (usuario_id, nombre, distrito, barrio, tipo_criadero, descripcion, foto_path, es_anonimo)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            usuario_id  || null,
            es_anonimo  ? 'Anónimo' : (nombre || 'Anónimo'),
            distrito,
            barrio      || null,
            tipo_criadero,
            descripcion || null,
            foto_path   || null,
            es_anonimo  ? true : false
        ]);

        res.status(201).json({
            ok: true,
            mensaje: 'Reporte guardado correctamente',
            id: result.insertId
        });
    } catch (error) {
        console.error('Error POST /reportes:', error);
        res.status(500).json({ ok: false, mensaje: 'Error al guardar el reporte' });
    }
});

module.exports = router;