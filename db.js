const mysql = require('mysql2');
require('dotenv').config();
const registrarError = require('./utils/log-error');

const pool = mysql.createPool({
    host:     process.env.DB_HOST,
    port:     process.env.DB_PORT,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit:    10,
    queueLimit:         0,
    multipleStatements: false
});

// Verificar conexión al arrancar
pool.getConnection((err, connection) => {
    if (err) {
        registrarError('❌ Error conectando a MySQL:', err);
        return;
    }
    console.log('✅ Conectado a MySQL');
    connection.release();
});

module.exports = pool.promise();
