const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../db');


// ============================================================
// CONFIGURACIÓN MOSKICHECK V3
// ============================================================
//
// La dirección del microservicio de IA se obtiene únicamente
// mediante variable de entorno.
//
// DESARROLLO LOCAL:
// MOSKICHECK_IA_URL=http://127.0.0.1:8000
//
// PRODUCCIÓN RAILWAY:
// MOSKICHECK_IA_URL=https://moskicheck-ia-production.up.railway.app
//
// La variable NO debe incluir "/predecir".
// ============================================================

const MOSKICHECK_IA_URL =
    process.env.MOSKICHECK_IA_URL?.trim();


// ============================================================
// CAMPOS OFICIALES MOSKICHECK V3
// ============================================================

// 11 síntomas utilizados por el modelo de Machine Learning.
const SINTOMAS_MODELO = [
    'sudden_fever',
    'headache',
    'muscle_pain',
    'joint_pain',
    'vomiting',
    'rash',
    'nausea',
    'fatigue',
    'orbital_pain',
    'red_eyes',
    'swelling'
];


// 3 preguntas de seguridad.
// NO son utilizadas por el modelo de Machine Learning.
const SENALES_SEGURIDAD = [
    'dolor_abdominal_intenso',
    'sangrado',
    'vomitos_persistentes'
];


// Total de campos que debe enviar Android.
const CAMPOS_ESPERADOS = [
    ...SINTOMAS_MODELO,
    ...SENALES_SEGURIDAD
];


// Estados permitidos devueltos por MoskiCheck IA V3.
const ESTADOS_PERMITIDOS = [
    'orientation',
    'inconclusive',
    'alert'
];


// ============================================================
// FUNCIÓN DE VALIDACIÓN
// ============================================================

function validarEvaluacion(body) {

    if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body)
    ) {

        return {
            valido: false,
            mensaje:
                'El cuerpo de la solicitud debe ser un objeto JSON.'
        };
    }


    // --------------------------------------------------------
    // Verificar que estén presentes los 14 campos
    // --------------------------------------------------------

    const faltantes =
        CAMPOS_ESPERADOS.filter(
            campo =>
                !Object.prototype.hasOwnProperty.call(
                    body,
                    campo
                )
        );


    if (faltantes.length > 0) {

        return {
            valido: false,
            mensaje:
                `Faltan campos obligatorios: ${faltantes.join(', ')}`
        };
    }


    // --------------------------------------------------------
    // Todos los valores deben ser exactamente 0 o 1
    // --------------------------------------------------------

    const invalidos =
        CAMPOS_ESPERADOS.filter(
            campo => {

                const valor =
                    body[campo];

                return (
                    valor !== 0 &&
                    valor !== 1
                );
            }
        );


    if (invalidos.length > 0) {

        return {
            valido: false,
            mensaje:
                `Los siguientes campos deben contener únicamente 0 o 1: ` +
                invalidos.join(', ')
        };
    }


    return {
        valido: true
    };
}


// ============================================================
// ENDPOINT PRINCIPAL
// POST /api/diagnosticos/analizar
// ============================================================

router.post(
    '/analizar',
    async (req, res) => {

        try {

            // =================================================
            // 1. VERIFICAR CONFIGURACIÓN DEL SERVICIO DE IA
            // =================================================

            if (!MOSKICHECK_IA_URL) {

                console.error(
                    '❌ MOSKICHECK_IA_URL no está configurada.'
                );

                return res.status(503).json({
                    ok: false,
                    error:
                        'El servicio de inteligencia artificial no está configurado correctamente.'
                });
            }


            // =================================================
            // 2. VALIDAR DATOS RECIBIDOS DESDE ANDROID
            // =================================================

            const validacion =
                validarEvaluacion(
                    req.body
                );


            if (!validacion.valido) {

                return res.status(400).json({
                    ok: false,
                    error:
                        'Datos de evaluación inválidos.',
                    detalle:
                        validacion.mensaje
                });
            }


            // =================================================
            // 3. CONSTRUIR JSON EXACTO PARA MOSKICHECK IA V3
            // =================================================

            const evaluacion = {};


            CAMPOS_ESPERADOS.forEach(
                campo => {

                    evaluacion[campo] =
                        req.body[campo];
                }
            );


            // =================================================
            // 4. LLAMAR A MOSKICHECK IA V3
            //
            // El backend NO determina:
            //
            // - si el usuario está sano;
            // - si existen pocos síntomas;
            // - si existe una señal de alarma;
            // - si la confianza es suficiente.
            //
            // Toda la lógica de evaluación pertenece al
            // microservicio MoskiCheck IA.
            // =================================================

            const baseUrlIA =
                MOSKICHECK_IA_URL.replace(
                    /\/+$/,
                    ''
                );


            const endpointIA =
                `${baseUrlIA}/predecir`;


            let respuestaIA;


            try {

                const respuestaPython =
                    await axios.post(
                        endpointIA,
                        evaluacion,
                        {
                            timeout: 15000,

                            headers: {
                                'Content-Type':
                                    'application/json'
                            }
                        }
                    );


                respuestaIA =
                    respuestaPython.data;


            } catch (errorIA) {

                console.error(
                    '❌ Error comunicándose con MoskiCheck IA:',
                    errorIA.message
                );


                if (
                    errorIA.response?.data
                ) {

                    console.error(
                        'Detalle MoskiCheck IA:',
                        errorIA.response.data
                    );
                }


                return res.status(502).json({
                    ok: false,
                    error:
                        'No fue posible comunicarse correctamente con el servicio de inteligencia artificial.'
                });
            }


            // =================================================
            // 5. VALIDAR RESPUESTA DE LA IA
            // =================================================

            if (
                !respuestaIA ||
                !ESTADOS_PERMITIDOS.includes(
                    respuestaIA.status
                )
            ) {

                console.error(
                    '❌ Respuesta inesperada de MoskiCheck IA:',
                    respuestaIA
                );


                return res.status(502).json({
                    ok: false,
                    error:
                        'El servicio de inteligencia artificial devolvió una respuesta inesperada.'
                });
            }


            // =================================================
            // 6. PREPARAR INFORMACIÓN PARA BASE DE DATOS
            // =================================================

            const estado =
                respuestaIA.status;


            const resultadoIA =
                respuestaIA.prediction ??
                null;


            const confianzaIA =
                respuestaIA.confidence ??
                null;


            const probabilidadesJSON =
                respuestaIA.probabilities
                    ? JSON.stringify(
                        respuestaIA.probabilities
                    )
                    : null;


            const alertasJSON =
                Array.isArray(
                    respuestaIA.alerts_detected
                )
                    ? JSON.stringify(
                        respuestaIA.alerts_detected
                    )
                    : null;


            const mensajeIA =
                respuestaIA.message ??
                null;


            const versionModelo =
                respuestaIA.model_version ??
                null;


            const cantidadSintomas =
                Number.isInteger(
                    respuestaIA.symptom_count
                )
                    ? respuestaIA.symptom_count
                    : null;


            // =================================================
            // 7. GUARDAR EN TABLA MOSKICHECK V3
            //
            // Se conserva la tabla antigua "sintomas".
            //
            // Las nuevas evaluaciones se almacenan únicamente
            // en "evaluaciones_moskicheck".
            // =================================================

            const querySQL = `
                INSERT INTO evaluaciones_moskicheck (
                    sudden_fever,
                    headache,
                    muscle_pain,
                    joint_pain,
                    vomiting,
                    rash,
                    nausea,
                    fatigue,
                    orbital_pain,
                    red_eyes,
                    swelling,

                    dolor_abdominal_intenso,
                    sangrado,
                    vomitos_persistentes,

                    estado,
                    resultado_ia,
                    confianza_ia,
                    probabilidades,
                    alertas_detectadas,
                    cantidad_sintomas,
                    mensaje_ia,
                    modelo_version
                )
                VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?
                )
            `;


            const valores = [

                // ---------------------------------------------
                // 11 síntomas utilizados por Machine Learning
                // ---------------------------------------------

                evaluacion.sudden_fever,
                evaluacion.headache,
                evaluacion.muscle_pain,
                evaluacion.joint_pain,
                evaluacion.vomiting,
                evaluacion.rash,
                evaluacion.nausea,
                evaluacion.fatigue,
                evaluacion.orbital_pain,
                evaluacion.red_eyes,
                evaluacion.swelling,


                // ---------------------------------------------
                // 3 señales de seguridad
                // ---------------------------------------------

                evaluacion.dolor_abdominal_intenso,
                evaluacion.sangrado,
                evaluacion.vomitos_persistentes,


                // ---------------------------------------------
                // Resultado MoskiCheck IA V3
                // ---------------------------------------------

                estado,
                resultadoIA,
                confianzaIA,
                probabilidadesJSON,
                alertasJSON,
                cantidadSintomas,
                mensajeIA,
                versionModelo
            ];


            await db.query(
                querySQL,
                valores
            );


            // =================================================
            // 8. RESPONDER A LA APLICACIÓN ANDROID
            // =================================================

            return res.status(200).json({

                ok: true,

                mensaje:
                    'Evaluación procesada y almacenada correctamente.',

                resultado_inteligencia_artificial:
                    respuestaIA
            });


        } catch (error) {

            console.error(
                '❌ Error en /api/diagnosticos/analizar:',
                error
            );


            return res.status(500).json({

                ok: false,

                error:
                    'Error interno del servidor al procesar la evaluación.'
            });
        }
    }
);


module.exports = router;