// Límites de la API; contrastarlos con el esquema de producción antes del despliegue.
const LIMITES_TEXTO = Object.freeze({
    nombre: 255,
    distrito: 255,
    barrio: 255,
    tipo_criadero: 255,
    descripcion: 10000,
    foto_path: 2048
});

function validarTexto(valor, campo) {
    if (valor === undefined || valor === null) {
        return { valor: null };
    }
    if (typeof valor !== 'string') {
        return { mensaje: `${campo} debe ser texto` };
    }
    // MySQL cuenta caracteres, no unidades UTF-16.
    if (Array.from(valor).length > LIMITES_TEXTO[campo]) {
        return { mensaje: `${campo} no debe superar ${LIMITES_TEXTO[campo]} caracteres` };
    }
    return { valor: valor.trim() || null };
}

function validarReporte(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { mensaje: 'El cuerpo de la solicitud debe ser un objeto JSON' };
    }

    const reporte = {};
    for (const campo of Object.keys(LIMITES_TEXTO)) {
        const resultado = validarTexto(body[campo], campo);
        if (resultado.mensaje) return resultado;
        reporte[campo] = resultado.valor;
    }
    if (!reporte.distrito || !reporte.tipo_criadero) {
        return { mensaje: 'Distrito y tipo de criadero son obligatorios' };
    }

    // Aceptar JSON y formularios existentes sin interpretar "false" como true.
    const anonimo = body.es_anonimo;
    if ([true, 1, '1', 'true'].includes(anonimo)) {
        reporte.es_anonimo = true;
    } else if ([undefined, null, false, 0, '0', 'false', ''].includes(anonimo)) {
        reporte.es_anonimo = false;
    } else {
        return { mensaje: 'es_anonimo debe ser un booleano o 0/1' };
    }

    const usuarioId = body.usuario_id;
    if ([undefined, null, '', 0].includes(usuarioId)) {
        reporte.usuario_id = null;
    } else if (
        (typeof usuarioId === 'number' ||
            (typeof usuarioId === 'string' && /^\d+$/.test(usuarioId))) &&
        Number.isSafeInteger(Number(usuarioId)) && Number(usuarioId) > 0
    ) {
        reporte.usuario_id = Number(usuarioId);
    } else {
        return { mensaje: 'usuario_id debe ser un entero positivo' };
    }

    return { reporte };
}

module.exports = { validarReporte, validarTexto };
