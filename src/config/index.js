require('dotenv').config();

process.env.TZ = process.env.TZ || 'America/Bogota';

const produccion = process.env.NODE_ENV === 'production';

function requerida(nombre) {
  const valor = process.env[nombre];
  if (valor === undefined || valor === '') throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

const sessionSecret = requerida('SESSION_SECRET');
if (produccion && sessionSecret.length < 32) throw new Error('SESSION_SECRET debe tener al menos 32 caracteres');
// En produccion la firma depende del OTP por correo y la cookie de sesion es secure: sin SMTP ni https no arranca.
if (produccion && !process.env.SMTP_HOST) throw new Error('SMTP_HOST es obligatorio en produccion');
if (produccion && !/^https:\/\//.test(process.env.APP_URL || '')) throw new Error('APP_URL debe ser https en produccion');

module.exports = Object.freeze({
  produccion,
  puerto: Number(process.env.PORT || 3000),
  // Detras del reverse proxy: solo loopback.
  host: process.env.HOST || '127.0.0.1',
  zonaHoraria: process.env.TZ,
  db: Object.freeze({
    host: requerida('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: requerida('DB_USER'),
    password: process.env.DB_PASSWORD || '',
    database: requerida('DB_NAME'),
  }),
  sesion: Object.freeze({
    secreto: sessionSecret,
    horas: Number(process.env.SESSION_HORAS || 8),
  }),
  regionDatos: process.env.REGION_DATOS || 'co-bogota',
  appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  almacen: Object.freeze({
    dir: require('path').resolve(process.env.ALMACEN_DIR || './almacen'),
    maxBytes: Number(process.env.ARCHIVO_MAX_MB || 20) * 1048576,
  }),
  // Tope del ZIP del expediente (se arma en memoria).
  expedienteMaxMb: Number(process.env.EXPEDIENTE_MAX_MB || 1024),
  // Suscripciones: dias de gracia tras el vencimiento antes de suspender (vacio = nunca automatico)
  // y dias antes del fin en que se avisa al administrador del cliente.
  suscripciones: Object.freeze({
    diasGracia: process.env.SUSCRIPCION_DIAS_GRACIA ? Number(process.env.SUSCRIPCION_DIAS_GRACIA) : null,
    avisos: (process.env.SUSCRIPCION_AVISOS || '15,5,1').split(',').map(Number).filter(Number.isInteger),
    ventana: Number(process.env.SUSCRIPCION_VENTANA || 30),
  }),
  // Tamano minimo de un grupo en el consolidado psicosocial: evita reidentificar personas.
  psicosocialMinGrupo: Number(process.env.PSICOSOCIAL_MIN_GRUPO || 5),
  // Sin SMTP_HOST los correos se registran como 'omitido' en notificacion_envio.
  smtp: Object.freeze({
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'Fenix SST <no-responder@localhost>',
  }),
});
