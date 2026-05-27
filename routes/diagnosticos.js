const express = require('express');
const router = express.Router();
const axios = require('axios');

// ⚠️ IMPORTANTE: Ajusta esta ruta a donde tengas tu conexión a MySQL
// Viendo tu imagen, parece que está en la carpeta config
const db = require('../config/db'); 

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

        db.query(querySQL, valores, (error, result) => {
            if (error) {
                console.error("❌ Error al guardar en MySQL:", error);
                return res.status(500).json({ error: "Error al guardar el registro en la base de datos." });
            }

            // 3. Responder a la App Android
            res.status(200).json({
                ok: true,
                mensaje: "Diagnóstico procesado y guardado correctamente",
                resultado_inteligencia_artificial: respuestaPython.data
            });
        });

    } catch (error) {
        console.error("❌ Error de comunicación con la IA:", error.message);
        res.status(500).json({ 
            ok: false,
            error: "No se pudo contactar al servidor de Inteligencia Artificial." 
        });
    }
});

module.exports = router;