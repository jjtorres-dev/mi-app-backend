const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const axios = require('axios');

// Simular solo servicios externos; las solicitudes atraviesan Express y sus parsers.
let consultar;
let ejecutar;
require.cache[require.resolve('../db')] = {
    id: require.resolve('../db'),
    filename: require.resolve('../db'),
    loaded: true,
    exports: {
        query: (...args) => consultar(...args),
        execute: (...args) => ejecutar(...args)
    }
};
process.env.MOSKICHECK_IA_URL = 'http://127.0.0.1:8000';
const app = require('../server');
const originalPost = axios.post;
const originalLog = console.error;
let logs;
let server;
let base;

const campos = [
    'sudden_fever', 'headache', 'muscle_pain', 'joint_pain', 'vomiting',
    'rash', 'nausea', 'fatigue', 'orbital_pain', 'red_eyes', 'swelling',
    'dolor_abdominal_intenso', 'sangrado', 'vomitos_persistentes'
];
const evaluacion = Object.fromEntries(campos.map(campo => [campo, 0]));
const reporte = { distrito: 'Piura', tipo_criadero: 'Recipiente con agua' };

before(async () => {
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
    console.error = (...args) => logs.push(args);
});
beforeEach(() => {
    logs = [];
    consultar = ejecutar = async () => { throw new Error('Consulta no prevista'); };
    axios.post = async () => { throw new Error('Llamada IA no prevista'); };
});
after(async () => {
    axios.post = originalPost;
    console.error = originalLog;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
});

async function solicitar(path, body, options = {}) {
    const response = await fetch(`${base}${path}`, {
        ...(body === undefined ? {} : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }),
        ...options
    });
    assert.match(response.headers.get('content-type'), /application\/json/);
    return { status: response.status, body: await response.json(), headers: response.headers };
}

test('health y raíz conservan los campos existentes', async () => {
    const health = await solicitar('/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'online');
    assert.equal(health.body.service, 'moskicheck-backend');
    assert.equal(health.body.version, '3.0.0');
    assert.equal(health.body.ok, true);
    const root = await solicitar('/');
    assert.equal(root.status, 200);
    assert.equal(root.body.rutas.length, 8);
    assert.equal(root.body.data.version, '3.0.0');
});

test('headers de seguridad y CORS mantienen acceso Android y web', async () => {
    consultar = async () => [[]];
    const response = await solicitar('/api/reportes', undefined, { headers: { Origin: 'https://example.com' } });
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    const alternateCase = await solicitar('/API/REPORTES');
    assert.equal(alternateCase.status, 200);
    assert.equal(alternateCase.headers.get('cache-control'), 'no-store');
    const preflight = await fetch(`${base}/api/reportes`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST' }
    });
    assert.equal(preflight.status, 204);
});

test('404 y errores de parser siempre devuelven JSON seguro', async () => {
    const missing = await solicitar('/ruta-inexistente');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.ok, false);
    assert.equal(missing.body.mensaje, missing.body.error);
    for (const [body, status] of [['{"dato":', 400], [JSON.stringify({ dato: 'x'.repeat(1024 * 1024) }), 413]]) {
        const result = await solicitar('/api/reportes', undefined, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body
        });
        assert.equal(result.status, status);
        assert.equal(result.body.ok, false);
        assert.equal(typeof result.body.mensaje, 'string');
        assert.equal(result.body.stack, undefined);
    }
    const unsupported = await solicitar('/api/reportes', undefined, {
        method: 'POST', headers: { 'Content-Type': 'application/json; charset=invalid' }, body: '{}'
    });
    assert.equal(unsupported.status, 415);
});

test('reportes, totales y ranking conservan sus envoltorios Android', async () => {
    const row = {
        id: 1, nombre: 'Nombre voluntario', distrito: 'Piura', barrio: null,
        tipo_criadero: 'Recipiente con agua', descripcion: null, foto_path: null,
        fecha_hora: '2026-09-28T12:00:00.000Z', es_anonimo: 0, estado: 'pendiente',
        latitude: null, longitude: null, accuracy: null, locationCapturedAt: null
    };
    consultar = async () => [[row]];
    assert.deepEqual((await solicitar('/api/reportes')).body, { ok: true, data: [row] });
    consultar = async sql => sql.includes('COUNT(DISTINCT')
        ? [[{ total_distritos: 1 }]] : [[{ total_reportes: 2 }]];
    assert.deepEqual((await solicitar('/api/reportes/total')).body.data, { total_reportes: 2, total_distritos: 1 });
    const zona = { distrito: 'Piura', total_reportes: 2, recipiente: 2, llanta: 0, acequia: 0, maleza: 0, basura: 0 };
    consultar = async () => [[zona]];
    assert.deepEqual((await solicitar('/api/reportes/por-distrito')).body, { ok: true, data: [zona] });
});

test('POST conserva id principal, nombres voluntarios y campos opcionales', async () => {
    let valores;
    ejecutar = async (_sql, params) => { valores = params; return [{ insertId: 42 }]; };
    const response = await solicitar('/api/reportes', {
        ...reporte, nombre: ' Ana Pérez ', barrio: '', descripcion: '', es_anonimo: false
    });
    assert.equal(response.status, 201);
    assert.deepEqual(response.body, { ok: true, mensaje: 'Reporte guardado correctamente', id: 42 });
    assert.deepEqual(valores, [null, 'Ana Pérez', 'Piura', null, 'Recipiente con agua', null, null,
        false, null, null, null, null]);
});

test('POST guarda una captura puntual y rechaza coordenadas incompletas', async () => {
    let valores;
    ejecutar = async (_sql, params) => { valores = params; return [{ insertId: 43 }]; };
    const fecha = '2026-09-30T12:34:56.789Z';
    const correcto = await solicitar('/api/reportes', {
        ...reporte, latitude: -6.487, longitude: -76.36, accuracy: 12.5, locationCapturedAt: fecha
    });
    assert.equal(correcto.status, 201);
    assert.deepEqual(valores.slice(8), [-6.487, -76.36, 12.5, '2026-09-30 12:34:56.789']);
    for (const datos of [
        { latitude: -6.487 }, { longitude: -76.36 }, { latitude: 91, longitude: 0 },
        { latitude: 0, longitude: -181 }, { latitude: 0, longitude: 0, accuracy: -1 },
        { accuracy: 5 }, { locationCapturedAt: fecha },
        { latitude: 0, longitude: 0, locationCapturedAt: 'ayer' }
    ]) {
        assert.equal((await solicitar('/api/reportes', { ...reporte, ...datos })).status, 400);
    }
});

test('anonimato admite booleanos y 0/1 sin confundir la cadena false', async () => {
    let valores;
    for (const [valor, esperado] of [[true, true], [1, true], ['true', true], ['1', true], [false, false], [0, false], ['false', false], ['0', false], [null, false]]) {
        ejecutar = async (_sql, params) => { valores = params; return [{ insertId: 1 }]; };
        const result = await solicitar('/api/reportes', { ...reporte, nombre: 'Ana', es_anonimo: valor });
        assert.equal(result.status, 201);
        assert.equal(valores[7], esperado);
        assert.equal(valores[1], esperado ? 'Anónimo' : 'Ana');
    }
    const unnamed = await solicitar('/api/reportes', reporte);
    assert.equal(unnamed.status, 201);
    assert.equal(valores[1], 'Anónimo');
    const blank = await solicitar('/api/reportes', { ...reporte, nombre: '   ', es_anonimo: false });
    assert.equal(blank.status, 201);
    assert.equal(valores[1], 'Anónimo');
});

test('formularios urlencoded existentes continúan funcionando', async () => {
    let valores;
    ejecutar = async (_sql, params) => { valores = params; return [{ insertId: 1 }]; };
    const result = await solicitar('/api/reportes', undefined, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...reporte, nombre: 'Ana', es_anonimo: 'false', usuario_id: '7' }).toString()
    });
    assert.equal(result.status, 201);
    assert.equal(valores[0], 7);
    assert.equal(valores[7], false);
});

test('entradas inválidas se rechazan antes de consultar MySQL', async () => {
    const invalidos = [
        {}, [], null, { ...reporte, distrito: '  ' }, { ...reporte, tipo_criadero: '' },
        { ...reporte, distrito: {} }, { ...reporte, barrio: [] }, { ...reporte, nombre: 123 },
        { ...reporte, descripcion: {} }, { ...reporte, foto_path: {} },
        { ...reporte, usuario_id: -1 }, { ...reporte, usuario_id: {} },
        { ...reporte, usuario_id: '1 OR 1=1' }, { ...reporte, es_anonimo: 'sí' }
    ];
    for (const body of invalidos) {
        const result = await solicitar('/api/reportes', body);
        assert.equal(result.status, 400);
        assert.equal(result.body.ok, false);
        assert.equal(typeof result.body.mensaje, 'string');
    }
    assert.equal((await solicitar('/api/reportes', undefined, { method: 'POST' })).status, 400);
});

test('longitudes máximas se aplican sin truncar los textos', async () => {
    for (const [campo, limite] of Object.entries({
        nombre: 255, distrito: 255, barrio: 255, tipo_criadero: 255, descripcion: 10000, foto_path: 2048
    })) {
        const invalid = await solicitar('/api/reportes', { ...reporte, [campo]: 'x'.repeat(limite + 1) });
        assert.equal(invalid.status, 400, campo);
        ejecutar = async () => [{ insertId: 1 }];
        const valid = await solicitar('/api/reportes', { ...reporte, [campo]: 'x'.repeat(limite) });
        assert.equal(valid.status, 201, campo);
    }
    ejecutar = async () => [{ insertId: 1 }];
    assert.equal((await solicitar('/api/reportes', { ...reporte, nombre: '😀'.repeat(255) })).status, 201);
});

test('todos los errores MySQL son genéricos y no registran datos privados', async () => {
    const error = Object.assign(new Error('SELECT contraseña FROM usuarios'), {
        code: 'ER_TEST', sql: 'dato privado', sqlMessage: 'dato privado'
    });
    consultar = ejecutar = async () => { throw error; };
    const solicitudes = [
        ['/api/reportes'], ['/api/reportes/total'], ['/api/reportes/por-distrito'],
        ['/api/reportes', reporte], ['/api/alertas/hoy'], ['/api/alertas/calcular', {}],
        ['/api/diagnosticos/analizar', evaluacion]
    ];
    axios.post = async () => ({ data: { status: 'orientation' } });
    for (const [path, body] of solicitudes) {
        const response = await solicitar(path, body);
        assert.equal(response.status, 500, path);
        assert.equal(response.body.ok, false);
        assert.equal(typeof response.body.mensaje, 'string');
        assert.doesNotMatch(JSON.stringify(response.body), /contraseña|dato privado|SELECT/);
    }
    assert.doesNotMatch(JSON.stringify(logs), /contraseña|dato privado|SELECT/);
});

test('alertas conservan objeto por distrito, lista general y valor sin reportes', async () => {
    const alerta = { distrito: 'Piura', nivel: 'bajo', total_reportes: 1, total_sintomas: 0, descripcion: 'Texto', fecha: '2026-09-28' };
    ejecutar = async () => [[alerta]];
    assert.deepEqual((await solicitar('/api/alertas/hoy?distrito=Piura')).body.data, alerta);
    assert.deepEqual((await solicitar('/api/alertas/hoy')).body.data, [alerta]);
    ejecutar = async () => [[]];
    assert.deepEqual((await solicitar('/api/alertas/hoy?distrito=Piura')).body.data, {
        nivel: 'bajo', descripcion: 'Sin reportes recientes en tu zona', total_reportes: 0
    });
    assert.equal((await solicitar('/api/alertas/hoy?distrito=Piura&distrito=Lima')).status, 400);
    assert.equal((await solicitar(`/api/alertas/hoy?distrito=${'x'.repeat(256)}`)).status, 400);
});

test('cálculo de alertas conserva los cuatro umbrales', async () => {
    consultar = async () => [[0, 10, 20, 30].map(total_reportes => ({ distrito: 'Piura', total_reportes }))];
    const niveles = [];
    ejecutar = async (_sql, params) => { niveles.push(params[1]); return [{}]; };
    const response = await solicitar('/api/alertas/calcular', {});
    assert.equal(response.status, 200);
    assert.deepEqual(niveles, ['bajo', 'moderado', 'alto', 'critico']);
    assert.equal(response.body.data.total_distritos, 4);
});

test('diagnósticos requieren los 14 valores exactos y conservan error y detalle', async () => {
    for (const body of [{}, [], { ...evaluacion, rash: true }, { ...evaluacion, rash: '1' }]) {
        const response = await solicitar('/api/diagnosticos/analizar', body);
        assert.equal(response.status, 400);
        assert.equal(response.body.ok, false);
        assert.equal(response.body.error, 'Datos de evaluación inválidos.');
        assert.equal(response.body.mensaje, response.body.detalle);
    }
});

test('diagnósticos conservan cada estado y el resultado IA íntegro', async () => {
    for (const status of ['orientation', 'inconclusive', 'alert']) {
        const resultado = { status, prediction: null, confidence: null, probabilities: null, alerts_detected: [], message: 'Mensaje', symptom_count: 0, model_version: 'test' };
        axios.post = async (url, body, config) => {
            assert.equal(url, 'http://127.0.0.1:8000/predecir');
            assert.deepEqual(body, evaluacion);
            assert.equal(config.timeout, 15000);
            return { data: resultado };
        };
        ejecutar = async () => [{}];
        const response = await solicitar('/api/diagnosticos/analizar', { ...evaluacion, extra: 'ignorado' });
        assert.equal(response.status, 200);
        assert.equal(response.body.ok, true);
        assert.deepEqual(response.body.resultado_inteligencia_artificial, resultado);
        assert.deepEqual(response.body.data, resultado);
    }
});

test('fallos e inconsistencias IA devuelven 502 sin exponer respuestas externas', async () => {
    for (const fallo of ['timeout', 'http', 'status', 'null']) {
        axios.post = async () => {
            if (fallo === 'timeout') throw Object.assign(new Error('datos privados'), { code: 'ECONNABORTED' });
            if (fallo === 'http') throw Object.assign(new Error('datos privados'), { response: { status: 500, data: 'datos privados' } });
            return { data: fallo === 'null' ? null : { status: 'invalid', message: 'datos privados' } };
        };
        const response = await solicitar('/api/diagnosticos/analizar', evaluacion);
        assert.equal(response.status, 502);
        assert.equal(response.body.mensaje, response.body.error);
        assert.doesNotMatch(JSON.stringify(response.body), /datos privados/);
    }
    assert.doesNotMatch(JSON.stringify(logs), /datos privados/);
});
