const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const mysql = require('mysql2/promise');
const { setTimeout: esperar } = require('node:timers/promises');

// Exclusivamente una base desechable en localhost. Nunca usar credenciales de Railway.
test('integración HTTP con MySQL real y esquema de prueba', {
    skip: !process.env.TEST_MYSQL_PORT && 'Configurar TEST_MYSQL_PORT para un MySQL desechable en localhost'
}, async t => {
    Object.assign(process.env, {
        DB_HOST: '127.0.0.1', DB_PORT: process.env.TEST_MYSQL_PORT,
        DB_USER: 'root', DB_PASSWORD: '', DB_NAME: 'moskicheck_test'
    });
    let connection;
    for (let intento = 0; intento < 30; intento++) {
        try {
            connection = await mysql.createConnection({
                host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
                user: process.env.DB_USER, password: process.env.DB_PASSWORD,
                database: process.env.DB_NAME, connectTimeout: 1000
            });
            break;
        } catch (error) {
            if (!['ECONNREFUSED', 'ECONNRESET', 'PROTOCOL_CONNECTION_LOST'].includes(error.code) || intento === 29) throw error;
            await esperar(1000);
        }
    }
    t.after(() => connection.end());

    // Fixture inferida de las consultas existentes; no representa el esquema de producción.
    const tablas = [
        `CREATE TABLE usuarios (
            id INT PRIMARY KEY AUTO_INCREMENT, nombre VARCHAR(100), apellidos VARCHAR(100)
        )`,
        `CREATE TABLE reportes (
            id INT PRIMARY KEY AUTO_INCREMENT, usuario_id INT NULL,
            nombre VARCHAR(255), distrito VARCHAR(255) NOT NULL, barrio VARCHAR(255),
            tipo_criadero VARCHAR(255) NOT NULL, descripcion TEXT, foto_path VARCHAR(2048),
            fecha_hora DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            es_anonimo TINYINT NOT NULL DEFAULT 0, estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',
            latitude DECIMAL(10,7) NULL, longitude DECIMAL(10,7) NULL,
            accuracy FLOAT NULL, location_captured_at DATETIME(3) NULL,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        )`,
        `CREATE TABLE alertas (
            id INT PRIMARY KEY AUTO_INCREMENT, distrito VARCHAR(255) NOT NULL,
            nivel VARCHAR(20) NOT NULL, total_reportes INT NOT NULL,
            total_sintomas INT NOT NULL DEFAULT 0, descripcion TEXT, fecha DATE NOT NULL,
            UNIQUE KEY distrito_fecha (distrito, fecha)
        )`,
        `CREATE TABLE evaluaciones_moskicheck (
            id INT PRIMARY KEY AUTO_INCREMENT,
            sudden_fever TINYINT, headache TINYINT, muscle_pain TINYINT, joint_pain TINYINT,
            vomiting TINYINT, rash TINYINT, nausea TINYINT, fatigue TINYINT, orbital_pain TINYINT,
            red_eyes TINYINT, swelling TINYINT, dolor_abdominal_intenso TINYINT,
            sangrado TINYINT, vomitos_persistentes TINYINT,
            estado VARCHAR(30), resultado_ia VARCHAR(100), confianza_ia DOUBLE,
            probabilidades JSON, alertas_detectadas JSON, cantidad_sintomas INT,
            mensaje_ia TEXT, modelo_version VARCHAR(100)
        )`
    ];
    for (const sql of tablas) await connection.query(sql);
    await connection.execute('INSERT INTO usuarios (nombre, apellidos) VALUES (?, ?)', ['Nombre privado', 'Apellido privado']);
    await connection.execute(`INSERT INTO reportes
        (usuario_id, nombre, distrito, tipo_criadero, es_anonimo)
        VALUES (1, ?, 'Piura', 'Recipiente con agua', 1)`, ['Nombre antiguo privado']);

    const resultadoIA = {
        status: 'orientation', prediction: null, confidence: null, probabilities: null,
        alerts_detected: [], symptom_count: 0, model_version: 'test', message: 'Respuesta simulada de IA'
    };
    const ia = http.createServer((req, res) => {
        assert.equal(req.url, '/predecir');
        req.resume();
        req.on('end', () => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(resultadoIA));
        });
    }).listen(0, '127.0.0.1');
    await once(ia, 'listening');
    t.after(() => new Promise(resolve => { ia.closeAllConnections(); ia.close(resolve); }));
    process.env.MOSKICHECK_IA_URL = `http://127.0.0.1:${ia.address().port}`;
    const app = require('../server');
    const db = require('../db');
    t.after(() => db.end());
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}`;

    async function solicitar(path, body) {
        const response = await fetch(`${base}${path}`, body === undefined ? {} : {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        return { status: response.status, body: await response.json() };
    }

    await t.test('GET /health responde 200', async () => {
        const response = await solicitar('/health');
        assert.equal(response.status, 200);
        assert.equal(response.body.status, 'online');
    });
    await t.test('GET /api/reportes protege identidades anónimas antiguas', async () => {
        const response = await solicitar('/api/reportes');
        assert.equal(response.status, 200);
        assert.deepEqual(Object.keys(response.body.data[0]).sort(), [
            'id', 'nombre', 'distrito', 'barrio', 'tipo_criadero', 'descripcion',
            'foto_path', 'fecha_hora', 'es_anonimo', 'estado',
            'latitude', 'longitude', 'accuracy', 'locationCapturedAt'
        ].sort());
        assert.equal(response.body.data[0].nombre, 'Anónimo');
        assert.equal(response.body.data[0].es_anonimo, 1);
        for (const campo of ['latitude', 'longitude', 'accuracy', 'locationCapturedAt']) {
            assert.equal(response.body.data[0][campo], null);
        }
        assert.doesNotMatch(JSON.stringify(response.body), /privado/);
    });
    await t.test('POST /api/reportes conserva formulario y nombres voluntarios', async () => {
        const response = await solicitar('/api/reportes', {
            nombre: 'Ana Pérez', distrito: 'Piura', barrio: 'Centro',
            tipo_criadero: 'Llanta/cubierta', descripcion: 'Reporte de prueba', es_anonimo: false
        });
        assert.equal(response.status, 201);
        assert.equal(Number.isInteger(response.body.id), true);
        const [[row]] = await connection.execute('SELECT * FROM reportes WHERE id = ?', [response.body.id]);
        assert.equal(row.nombre, 'Ana Pérez');
        assert.equal(row.es_anonimo, 0);
        assert.equal(row.usuario_id, null);
        assert.equal(row.estado, 'pendiente');
    });
    await t.test('POST /api/reportes anónimo conserva relación de usuario', async () => {
        const response = await solicitar('/api/reportes', {
            usuario_id: 1, nombre: 'Ocultar este nombre', distrito: 'Piura',
            tipo_criadero: 'Acequia o canal', es_anonimo: true
        });
        assert.equal(response.status, 201);
        const [[row]] = await connection.execute('SELECT * FROM reportes WHERE id = ?', [response.body.id]);
        assert.equal(row.nombre, 'Anónimo');
        assert.equal(row.es_anonimo, 1);
        assert.equal(row.usuario_id, 1);
        assert.equal(row.barrio, null);
    });
    await t.test('POST y GET /api/reportes conservan ubicación opcional', async () => {
        const response = await solicitar('/api/reportes', {
            distrito: 'Piura', tipo_criadero: 'Llanta/cubierta', latitude: -6.487,
            longitude: -76.36, accuracy: 12.5, locationCapturedAt: '2026-09-30T12:34:56.789Z'
        });
        assert.equal(response.status, 201);
        const [[row]] = await connection.execute('SELECT * FROM reportes WHERE id = ?', [response.body.id]);
        assert.equal(Number(row.latitude), -6.487);
        assert.equal(Number(row.longitude), -76.36);
        assert.equal(row.accuracy, 12.5);
        const listado = await solicitar('/api/reportes');
        const guardado = listado.body.data.find(item => item.id === response.body.id);
        assert.equal(Number(guardado.latitude), -6.487);
        assert.equal(guardado.locationCapturedAt, '2026-09-30T12:34:56.789000Z');
    });
    await t.test('SQL preparado almacena intentos de inyección como texto', async () => {
        const texto = "O'Connor'; DROP TABLE usuarios; --";
        const response = await solicitar('/api/reportes', {
            nombre: texto, distrito: 'Lima', tipo_criadero: 'Depósito de basura', descripcion: texto
        });
        assert.equal(response.status, 201);
        const [[row]] = await connection.execute('SELECT nombre, descripcion FROM reportes WHERE id = ?', [response.body.id]);
        assert.deepEqual(row, { nombre: texto, descripcion: texto });
        const [[users]] = await connection.query('SELECT COUNT(*) AS total FROM usuarios');
        assert.equal(users.total, 1);
    });
    await t.test('GET /api/reportes/total mantiene números y campos Android', async () => {
        const response = await solicitar('/api/reportes/total');
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { ok: true, data: { total_reportes: 5, total_distritos: 2 } });
    });
    await t.test('GET /api/reportes/por-distrito mantiene ranking semanal', async () => {
        const response = await solicitar('/api/reportes/por-distrito');
        assert.equal(response.status, 200);
        const piura = response.body.data.find(zona => zona.distrito === 'Piura');
        assert.equal(piura.total_reportes, 4);
        assert.equal(Number(piura.recipiente), 1);
        assert.equal(Number(piura.llanta), 2);
        assert.equal(Number(piura.acequia), 1);
        assert.equal(Number(piura.maleza), 0);
        assert.equal(Number(piura.basura), 0);
    });
    await t.test('validaciones devuelven 400 y no insertan registros', async () => {
        const response = await solicitar('/api/reportes', { distrito: ' ', tipo_criadero: 'Llanta/cubierta' });
        assert.equal(response.status, 400);
        const [[row]] = await connection.query('SELECT COUNT(*) AS total FROM reportes');
        assert.equal(row.total, 5);
    });
    await t.test('POST /api/alertas/calcular es idempotente con clave distrito/fecha', async () => {
        for (let i = 0; i < 2; i++) {
            const response = await solicitar('/api/alertas/calcular', {});
            assert.equal(response.status, 200);
            assert.equal(response.body.data.total_distritos, 2);
        }
        const [[row]] = await connection.query('SELECT COUNT(*) AS total FROM alertas');
        assert.equal(row.total, 2);
    });
    await t.test('GET /api/alertas/hoy conserva el objeto utilizado por Android', async () => {
        const response = await solicitar('/api/alertas/hoy?distrito=Piura');
        assert.equal(response.status, 200);
        assert.equal(response.body.data.nivel, 'bajo');
        assert.equal(response.body.data.total_reportes, 4);
    });
    await t.test('POST /api/diagnosticos/analizar persiste los 14 campos sin cambiar lógica IA', async () => {
        const evaluacion = Object.fromEntries([
            'sudden_fever', 'headache', 'muscle_pain', 'joint_pain', 'vomiting',
            'rash', 'nausea', 'fatigue', 'orbital_pain', 'red_eyes', 'swelling',
            'dolor_abdominal_intenso', 'sangrado', 'vomitos_persistentes'
        ].map(campo => [campo, 0]));
        const response = await solicitar('/api/diagnosticos/analizar', evaluacion);
        assert.equal(response.status, 200);
        assert.deepEqual(response.body.resultado_inteligencia_artificial, resultadoIA);
        const [[row]] = await connection.query('SELECT * FROM evaluaciones_moskicheck');
        assert.equal(row.estado, 'orientation');
        assert.equal(row.resultado_ia, null);
        assert.equal(row.sudden_fever, 0);
    });
});
