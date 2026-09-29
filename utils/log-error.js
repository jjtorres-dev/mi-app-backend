// No registrar SQL, parámetros, cuerpos HTTP ni respuestas que contengan datos personales.
function registrarError(contexto, error) {
    console.error(contexto, {
        codigo: typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR',
        ...(Number.isInteger(error?.response?.status)
            ? { estadoServicio: error.response.status }
            : {})
    });
}

module.exports = registrarError;
