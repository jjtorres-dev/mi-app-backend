const express = require('express');
const router = express.Router();
const axios = require('axios');

// Tu conexión a la base de datos
const db = require('../db'); // (O la ruta que hayas arreglado antes, como ../config/db)

router.post('/analizar', async (req, res) => {
    try {
        const sintomas = req.body;

        // 🌟 1. Sumamos todos los síntomas para ver si hay al menos un "1"
        const sumaSintomas = Object.values(sintomas).reduce((acc, valor) => acc + valor, 0);

        let resultadoIA = "";
        let confianzaIA = 0;
        let respuestaParaAndroid = {};

        // 🌟 2. CONDICIÓN BARRERA: Si todo es 0, el paciente está sano
        if (sumaSintomas === 0) {
            resultadoIA = "PACIENTE SANO (Sin síntomas)";
            confianzaIA = 1.0; // 100% de confianza
            
            // Simulamos la respuesta que daría Python para que Android no falle
            respuestaParaAndroid = {
                prediction: resultadoIA,
                confidence: confianzaIA,
                probabilities: {
                    "dengue": 0.0,
                    "zika": 0.0,
                    "chikungunya": 0.0,
                    "sano": 1.0
                }
            };
        } else {
            // 🌟 3. Si hay al menos un síntoma (1), llamamos a la IA en Python en la nube
            const urlPython = 'https://moskicheck-ia-production.up.railway.app/predecir';
            const respuestaPython = await axios.post(urlPython, sintomas);
            
            resultadoIA = respuestaPython.data.prediction;
            confianzaIA = respuestaPython.data.confidence;
            respuestaParaAndroid = respuestaPython.data;
        }

        // 4. Guardar SIEMPRE en la tabla 'sintomas' (incluso si está sano, para tu historial)
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

        // Ejecutamos la consulta a la base de datos usando AWAIT
        await db.query(querySQL, valores);

        // 5. Responder a la App Android INMEDIATAMENTE
        res.status(200).json({
            ok: true,
            mensaje: "Diagnóstico procesado y guardado correctamente",
            resultado_inteligencia_artificial: respuestaParaAndroid
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