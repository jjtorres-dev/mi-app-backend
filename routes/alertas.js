const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { validarTexto } = require('../utils/validation');
const registrarError = require('../utils/log-error');

// ── GET /api/alertas/hoy ──────────────────────────────────────────────────────
// Obtener la alerta del distrito para mostrar en el Home
router.get('/hoy', async (req, res) => {
    const validacion = validarTexto(req.query.distrito, 'distrito');
    if (validacion.mensaje) {
        return res.status(400).json({ ok: false, mensaje: validacion.mensaje });
    }
    const distrito = validacion.valor;

    try {
        let query = `
            SELECT distrito, nivel, total_reportes, total_sintomas, descripcion, fecha
            FROM alertas
            WHERE fecha = CURDATE()
        `;
        const params = [];

        if (distrito) {
            query += ' AND distrito = ?';
            params.push(distrito);
        }

        query += ' ORDER BY total_reportes DESC';

        const [alertas] = await db.execute(query, params);

        if (alertas.length === 0) {
            return res.json({
                ok: true,
                data: {
                    nivel: 'bajo',
                    descripcion: 'Sin reportes recientes en tu zona',
                    total_reportes: 0
                }
            });
        }

        res.json({ ok: true, data: distrito ? alertas[0] : alertas });
    } catch (error) {
        registrarError('Error GET /alertas/hoy:', error);
        res.status(500).json({ ok: false, mensaje: 'Error al obtener alertas' });
    }
});

// ── POST /api/alertas/calcular ────────────────────────────────────────────────
// Calcular y guardar el nivel de alerta del día (llamar una vez al día)
router.post('/calcular', async (req, res) => {
    try {
        const [distritos] = await db.query(`
            SELECT 
                distrito,
                COUNT(*) AS total_reportes
            FROM reportes
            WHERE fecha_hora >= NOW() - INTERVAL 7 DAY
            GROUP BY distrito
        `);

        for (const zona of distritos) {
            const nivel =
                zona.total_reportes >= 30 ? 'critico'  :
                zona.total_reportes >= 20 ? 'alto'     :
                zona.total_reportes >= 10 ? 'moderado' : 'bajo';

            const descripcion = `${zona.total_reportes} criaderos reportados esta semana en ${zona.distrito}.`;

            await db.execute(`
                INSERT INTO alertas (distrito, nivel, total_reportes, descripcion, fecha)
                VALUES (?, ?, ?, ?, CURDATE())
                ON DUPLICATE KEY UPDATE
                    nivel          = VALUES(nivel),
                    total_reportes = VALUES(total_reportes),
                    descripcion    = VALUES(descripcion)
            `, [zona.distrito, nivel, zona.total_reportes, descripcion]);
        }

        res.json({
            ok: true,
            mensaje: `Alertas calculadas para ${distritos.length} distritos`,
            data: { total_distritos: distritos.length }
        });
    } catch (error) {
        registrarError('Error POST /alertas/calcular:', error);
        res.status(500).json({ ok: false, mensaje: 'Error al calcular alertas' });
    }
});

module.exports = router;
