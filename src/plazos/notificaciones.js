// Resumen diario al responsable del SG-SST y escalamiento de vencidas al representante legal.
// Cada envio (enviado, fallido u omitido) queda en notificacion_envio como evidencia.
const cuentas = require('../db/cuentas');
const correo = require('../correo');
const reglas = require('./reglas');

const ROLES_RESPONSABLE = ['responsable_sst', 'consultor_sst'];
const ROLES_RESPALDO = ['admin_tenant'];
const ROLES_ESCALAMIENTO = ['gerente'];

async function registrarEnvio(repo, datos, resultado) {
  await repo.insertar('notificacion_envio', {
    ...datos,
    obligaciones: datos.obligaciones,
    estado: resultado.estado,
    error: resultado.error,
    enviado_en: new Date(),
  }, { auditar: false });
}

async function obligacionesAlerta(repo) {
  const filas = await repo.consultar(
    `SELECT o.*, e.razon_social, e.representante_legal_email
       FROM obligacion_pendiente o
       JOIN empresa e ON e.tenant_id = {tenant} AND e.id = o.empresa_id
      WHERE o.tenant_id = {tenant} AND o.estado IN ('por_vencer','vencido')`,
  );
  return filas.sort(reglas.compararUrgencia);
}

async function resumenDiario(repo, fecha, alertas) {
  const previos = await repo.listar('notificacion_envio', { tipo: 'resumen_diario', fecha_corte: fecha, estado: 'enviado' });
  if (previos.length || alertas.length === 0) return 0;

  let destinatarios = await cuentas.usuariosConRol(repo.tenantId, ROLES_RESPONSABLE);
  if (!destinatarios.length) destinatarios = await cuentas.usuariosConRol(repo.tenantId, ROLES_RESPALDO);

  const vencidas = alertas.filter((o) => o.estado === 'vencido');
  const porVencer = alertas.filter((o) => o.estado === 'por_vencer');
  const asunto = `SG-SST: ${vencidas.length} vencida(s), ${porVencer.length} por vencer (${fecha})`;
  for (const d of destinatarios) {
    const html = await correo.renderizar('resumen', { fecha, nombre: d.nombre, vencidas, porVencer });
    const res = await correo.enviar({ para: d.email, asunto, html });
    await registrarEnvio(repo, {
      tipo: 'resumen_diario', fecha_corte: fecha, destinatario_usuario_id: d.id, destinatario_email: d.email,
      asunto, obligaciones: alertas.map((o) => o.id),
    }, res);
  }
  return destinatarios.length;
}

// Se marca escalado_en solo si al menos un envio salio: si no hay SMTP, se reintenta al dia siguiente.
async function escalamiento(repo, fecha, alertas) {
  const pendientes = alertas.filter((o) => o.estado === 'vencido' && !o.escalado_en);
  if (!pendientes.length) return 0;

  const gerentes = await cuentas.usuariosConRol(repo.tenantId, ROLES_ESCALAMIENTO);
  const porEmpresa = new Map();
  for (const o of pendientes) {
    if (!porEmpresa.has(o.empresa_id)) porEmpresa.set(o.empresa_id, []);
    porEmpresa.get(o.empresa_id).push(o);
  }

  let escaladas = 0;
  for (const obligaciones of porEmpresa.values()) {
    const { razon_social: razonSocial, representante_legal_email: emailRl } = obligaciones[0];
    const destinos = new Map(gerentes.map((g) => [g.email.toLowerCase(), g.id]));
    if (emailRl && !destinos.has(emailRl.toLowerCase())) destinos.set(emailRl.toLowerCase(), null);
    if (!destinos.size) continue;

    const asunto = `SG-SST ${razonSocial}: ${obligaciones.length} obligacion(es) vencida(s)`;
    const html = await correo.renderizar('escalamiento', { fecha, razonSocial, obligaciones });
    let alguno = false;
    for (const [email, usuarioId] of destinos) {
      const res = await correo.enviar({ para: email, asunto, html });
      alguno = alguno || res.estado === 'enviado';
      await registrarEnvio(repo, {
        tipo: 'escalamiento', fecha_corte: fecha, destinatario_usuario_id: usuarioId, destinatario_email: email,
        asunto, obligaciones: obligaciones.map((o) => o.id),
      }, res);
    }
    if (!alguno) continue;
    for (const o of obligaciones) {
      await repo.actualizar('obligacion_pendiente', o.id, { escalado_en: new Date() }, { accion: 'escalar' });
      escaladas++;
    }
  }
  return escaladas;
}

async function notificarTenant(repo, fecha) {
  const alertas = await obligacionesAlerta(repo);
  return {
    resumenes: await resumenDiario(repo, fecha, alertas),
    escaladas: await escalamiento(repo, fecha, alertas),
  };
}

module.exports = { notificarTenant };
