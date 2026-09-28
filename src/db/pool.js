// Pool privado de la capa de datos. Fuera de src/db solo se usa via repositorio/global
// (lo verifica test/aislamiento.test.js).
const mysql = require('mysql2');
const config = require('../config');

const base = mysql.createPool({
  ...config.db,
  connectionLimit: 10,
  charset: 'utf8mb4_unicode_ci',
  timezone: '-05:00',
  dateStrings: ['DATE'],
  supportBigNumbers: true,
  bigNumberStrings: false,
  decimalNumbers: false,
});

// Colombia no tiene horario de verano: offset fijo evita depender de las tablas de zonas de MariaDB.
base.on('connection', (conn) => {
  conn.query("SET time_zone = '-05:00'");
});

module.exports = base.promise();
