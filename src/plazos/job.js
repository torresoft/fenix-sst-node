// Job diario: propaga boletines normativos, sincroniza vigencias de documentos, persiste
// transiciones de estado y notifica.
// Recorre tenant por tenant con su propio RepositorioTenant; un tenant con error no detiene a los demas.
const cuentas = require('../db/cuentas');
const { RepositorioTenant } = require('../db/repositorio');
const fechas = require('../fechas');
const servicio = require('./servicio');
const { notificarTenant } = require('./notificaciones');
const matriz = require('../matriz/servicio');
const gestor = require('../documentos/servicio');
const indicadores = require('../indicadores/servicio');

const ACTOR = Object.freeze({ id: null, nombre: 'job-diario' });

async function ejecutarJobDiario({ hoy = fechas.hoyBogota(), notificar = true, log = console } = {}) {
  await fechas.inicializar();
  const resumen = [];
  for (const t of await cuentas.tenantsActivos()) {
    const repo = new RepositorioTenant(t.id, ACTOR);
    try {
      const boletines = await matriz.propagarBoletines(repo);
      const retencion = await gestor.recalcularRetencion(repo);
      const documentos = await servicio.sincronizarDocumentos(repo, hoy);
      const transiciones = await servicio.recalcularEstados(repo, hoy);
      const avisos = notificar ? await notificarTenant(repo, hoy) : null;
      let medidos = 0;
      for (const e of await repo.listar('empresa', { estado: 'activa' })) {
        medidos += await indicadores.calcular(repo, e.id, Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)));
      }
      resumen.push({ tenant: t.id, boletines, retencion, documentos, transiciones: transiciones.length, avisos, medidos });
      log.info(`tenant ${t.id}: ${boletines} boletines, ${retencion} retenciones, docs +${documentos.creadas}/~${documentos.cumplidas}/x${documentos.anuladas}, `
        + `${transiciones.length} transiciones${avisos ? `, ${avisos.resumenes} resumenes, ${avisos.escaladas} escaladas` : ''}`);
    } catch (err) {
      resumen.push({ tenant: t.id, error: err.message });
      log.error(`tenant ${t.id}: ${err.message}`);
    }
  }
  return resumen;
}

module.exports = { ejecutarJobDiario };
