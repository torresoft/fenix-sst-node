// Store de sesiones en MariaDB (tabla sesion, creada por sql/02_nucleo.sql).
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const pool = require('./pool');

let store = null;

function crearStore() {
  store = new MySQLStore({
    createDatabaseTable: false,
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    endConnectionOnClose: false,
    schema: {
      tableName: 'sesion',
      columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' },
    },
  }, pool);
  return store;
}

// Detiene el intervalo de limpieza de sesiones (apagado limpio y pruebas).
async function cerrarStore() {
  if (store) await store.close();
  store = null;
}

module.exports = { crearStore, cerrarStore };
