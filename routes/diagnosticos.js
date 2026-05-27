const express = require('express');
const router = express.Router();
const axios = require('axios');

// Tu conexión a la base de datos
const db = require('../db'); // (O la ruta que hayas arreglado antes, como ../config/db)

router.post('/analizar', async (req, res) => {
    try {
        const sintomas = req.body;

        // 1. Petición a tu IA en Railway
        const urlPython = 'https://moskicheck-ia-production.up.railway.app/predecir';
        const respuestaPython = await axios.post(urlPython, sintomas);

        const resultadoIA = respuestaPython.data.prediction;
        const confianzaIA = respuestaPython.data.confidence;

        // 2. Guardar en la tabla 'sintomas'
        const querySQL = `
            INSERT INTO sintomas (
                fever, headache, joint_pain, muscle_pain, vomiting, rash, fatigue,
                eye_pain, nausea, chills, bleeding, red_eyes, joint_swelling, itching,
                resultado_ia, confianza_ia
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const valores = [
            sintomas.fever, sintomas.headache, sintomas.joint_pain, sintomas.muscle_pain,
            sintomas.vomiting, sintomas.rash, sintomas.fatigue, sintomas.eye_pain,
            sintomas.nausea, sintomas.chills, sintomas.bleeding, sintomas.red_eyes,
            sintomas.joint_swelling, sintomas.itching,
            resultadoIA, confianzaIA
        ];

        // 🌟 AQUÍ ESTÁ LA MAGIA: Usamos AWAIT en lugar de Callback
        await db.query(querySQL, valores);

        // 3. Responder a la App Android INMEDIATAMENTE
        res.status(200).json({
            ok: true,
            mensaje: "Diagnóstico procesado y guardado correctamente",
            resultado_inteligencia_artificial: respuestaPython.data
        });

    } catch (error) {
        console.error("❌ Error en la ruta de diagnóstico:", error.message);
        res.status(500).json({ 
            ok: false,
            error: "Error interno en el servidor Node.js al procesar la IA." 
        });
    }
});

module.exports = router;