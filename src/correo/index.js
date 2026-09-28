const path = require('path');
const ejs = require('ejs');
const nodemailer = require('nodemailer');
const config = require('../config');

let transporte = null;

function obtenerTransporte() {
  if (!config.smtp.host) return null;
  if (!transporte) {
    transporte = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporte;
}

function renderizar(plantilla, datos) {
  const archivo = path.join(__dirname, '..', 'views', 'correo', `${plantilla}.ejs`);
  return ejs.renderFile(archivo, { ...datos, appUrl: config.appUrl });
}

/** Devuelve { estado: 'enviado' | 'fallido' | 'omitido', error } sin lanzar. */
async function enviar({ para, asunto, html }) {
  const t = obtenerTransporte();
  if (!t) return { estado: 'omitido', error: 'SMTP no configurado' };
  try {
    await t.sendMail({ from: config.smtp.from, to: para, subject: asunto, html });
    return { estado: 'enviado', error: null };
  } catch (err) {
    return { estado: 'fallido', error: String(err.message).slice(0, 500) };
  }
}

module.exports = { enviar, renderizar };
