// Expediente del SG-SST para la visita de inspeccion: ZIP con documentos, manifiesto de integridad y
// firmas, indice HTML y verificador que funciona sin conexion (doc 08, parte B).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ejs = require('ejs');
const almacen = require('../documentos/almacen');
const autoevaluacion = require('../autoevaluacion/servicio');
const { aCsv: csvAutoevaluacion } = require('../autoevaluacion/exportar');
const peligros = require('../peligros/servicio');
const { crearZip } = require('./zip');
const config = require('../config');

// El ZIP se arma en memoria (sin ZIP64): tope de tamano y un expediente a la vez por tenant.
const MAX_BYTES = Math.min(config.expedienteMaxMb * 1048576, 3.5 * 1024 ** 3);
const enCurso = new Set();

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const segura = (s) => String(s).replace(/[^\w.-]+/g, '_');

async function datos(repo, empresaId, { historico = false } = {}) {
  const empresa = await repo.obtener('empresa', empresaId);
  const estados = historico ? "('vigente','reemplazado','anulado')" : "('vigente')";
  const docs = await repo.consultar(
    `SELECT d.id, d.codigo, d.version, d.titulo, d.tipo_documental, t.nombre AS tipo, t.origen_articulo, d.estado, d.fecha_documento,
            d.fecha_vence, d.archivo_ruta, d.archivo_hash, d.archivo_nombre, d.modalidad_firma, d.firmantes_externos, d.referencia_custodio, d.retencion_hasta
       FROM documento_sst d JOIN tipo_documental t ON t.codigo = d.tipo_documental
      WHERE d.tenant_id = {tenant} AND d.empresa_id = ? AND d.estado IN ${estados}
      ORDER BY t.nombre, d.codigo, d.version`, [empresaId],
  );
  const firmas = await repo.consultar(
    `SELECT f.entidad_id, f.firmante_nombre, f.firmante_documento, f.rol_firmante, f.metodo_auth, f.hash_contenido, f.texto_firmado, f.firmado_en
       FROM firma f JOIN documento_sst d ON d.tenant_id = {tenant} AND d.id = f.entidad_id
      WHERE f.tenant_id = {tenant} AND f.entidad = 'documento_sst' AND d.empresa_id = ?`, [empresaId],
  );
  return { empresa, docs, firmas };
}

function error(status, mensaje) {
  return Object.assign(new Error(mensaje), { status });
}

/** Genera el ZIP. Verifica cada archivo al empaquetarlo: si su huella no coincide, lo marca como alterado. */
async function generar(repo, empresaId, opciones = {}) {
  if (enCurso.has(repo.tenantId)) throw error(409, 'Ya se esta generando un expediente: espere a que termine');
  enCurso.add(repo.tenantId);
  try {
    return await armar(repo, empresaId, opciones);
  } finally {
    enCurso.delete(repo.tenantId);
  }
}

async function armar(repo, empresaId, opciones) {
  const { empresa, docs, firmas } = await datos(repo, empresaId, opciones);
  let total = 0;
  const generado = new Date();
  const archivos = [];
  const entradas = [];
  for (const d of docs) {
    const entrada = {
      codigo: d.codigo, version: d.version, titulo: d.titulo, tipo: d.tipo, articulo: d.origen_articulo, estado: d.estado,
      fecha: d.fecha_documento, vence: d.fecha_vence, retencion_hasta: d.retencion_hasta, modalidad_firma: d.modalidad_firma,
      firmantes_externos: d.firmantes_externos, custodio: d.referencia_custodio, sha256_registrado: d.archivo_hash, ruta: null, integridad: 'sin_archivo',
      firmas: firmas.filter((f) => f.entidad_id === d.id).map((f) => ({
        firmante: f.firmante_nombre, documento: f.firmante_documento, rol: f.rol_firmante, metodo: f.metodo_auth,
        sha256_firmado: f.hash_contenido, fecha: f.firmado_en, texto: f.texto_firmado,
      })),
    };
    if (d.archivo_ruta) {
      const ruta = `documentos/${segura(d.tipo_documental)}/${segura(d.codigo)}-v${d.version}${path.extname(d.archivo_nombre || d.archivo_ruta)}`;
      try {
        const abs = almacen.absoluta(d.archivo_ruta);
        total += (await fs.promises.stat(abs)).size;
        if (total > MAX_BYTES) throw error(413, `El expediente supera ${config.expedienteMaxMb} MB: genere solo los vigentes o pida el historico por partes`);
        const buffer = await fs.promises.readFile(abs);
        entrada.integridad = sha256(buffer) === d.archivo_hash ? 'integro' : 'alterado';
        entrada.ruta = ruta;
        archivos.push({ nombre: ruta, datos: buffer });
      } catch (err) {
        if (err.status) throw err;
        entrada.integridad = 'faltante';
      }
    }
    entradas.push(entrada);
  }

  const extras = [];
  const [matriz] = await repo.listar('matriz_riesgo', { empresa_id: empresaId, estado: 'vigente' });
  if (matriz) extras.push({ nombre: `csv/matriz-peligros-v${matriz.version}.csv`, datos: peligros.aCsv(await peligros.detalle(repo, empresaId, matriz.id)) });
  const autoevals = (await autoevaluacion.listar(repo, empresaId)).filter((a) => a.estado === 'cerrada');
  if (autoevals.length) {
    const d = await autoevaluacion.detalle(repo, empresaId, autoevals[0].id);
    extras.push({ nombre: `csv/autoevaluacion-${d.autoevaluacion.vigencia_anio}.csv`, datos: csvAutoevaluacion(d, empresa, await autoevaluacion.acciones(repo, empresaId, d.autoevaluacion.id)) });
  }

  const manifiesto = {
    expediente: 'SG-SST', empresa: { razon_social: empresa.razon_social, nit: `${empresa.nit}-${empresa.digito_verificacion || ''}` },
    generado_en: generado.toISOString(), generado_por: repo.actor.nombre, historico: Boolean(opciones.historico),
    documentos: entradas,
    anexos: extras.map((x) => ({ ruta: x.nombre, sha256: sha256(Buffer.from(x.datos)) })),
  };
  const json = JSON.stringify(manifiesto, null, 2);
  manifiesto.sha256_manifiesto = sha256(json);
  const vistas = path.join(__dirname, '..', 'views', 'expediente');
  const indice = await ejs.renderFile(path.join(vistas, 'indice.ejs'), { m: manifiesto });
  const verificador = await ejs.renderFile(path.join(vistas, 'verificar.ejs'), { m: manifiesto });

  const zip = crearZip([
    { nombre: 'index.html', datos: indice },
    { nombre: 'verificar.html', datos: verificador },
    { nombre: 'verificar.js', datos: fs.readFileSync(path.join(__dirname, 'verificar-offline.js')) },
    { nombre: 'manifiesto.js', datos: `window.MANIFIESTO = ${json};\n` },
    { nombre: 'manifiesto.json', datos: json },
    ...extras,
    ...archivos,
  ], generado);
  await repo.auditar('exportar', 'expediente', empresaId, null, {
    documentos: entradas.length, archivos: archivos.length, alterados: entradas.filter((e) => e.integridad === 'alterado').length,
    sha256_manifiesto: manifiesto.sha256_manifiesto, sha256_zip: sha256(zip),
  });
  return { zip, manifiesto, nombre: `expediente-sgsst-${segura(empresa.nit)}-${generado.toISOString().slice(0, 10)}.zip` };
}

module.exports = { generar };
