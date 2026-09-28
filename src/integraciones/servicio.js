// Integraciones por archivo: nomina (ingresos y retiros), planillas PILA de contratistas y FURAT para la ARL.
// Cada importacion se simula primero; al aplicarla queda en la bitacora con la huella del archivo.
const crypto = require('crypto');
const { hoyBogota, textoBogota } = require('../fechas/calendario');
const personas = require('../personas/servicio');
const contratistas = require('../contratistas/servicio');
const { error } = require('../comun/rutas');
const csv = require('./csv');

const MAX_FILAS = 2000;
const COLUMNAS_NOMINA = ['tipo_documento', 'numero_documento', 'nombres', 'apellidos', 'fecha_ingreso', 'tipo_vinculacion', 'cargo', 'fecha_retiro', 'motivo_retiro', 'sexo', 'fecha_nacimiento', 'email'];
const COLUMNAS_PILA = ['numero_documento', 'nit_contratista', 'periodo', 'planilla', 'arl', 'fecha_pago', 'clase_riesgo'];

function leer(archivo, requeridas) {
  if (!archivo || !archivo.buffer) throw error(422, 'Adjunte el archivo CSV');
  const filas = csv.parsear(archivo.buffer.toString('utf8'), MAX_FILAS);
  if (!filas.length) throw error(422, 'El archivo no tiene filas');
  if (filas.length > MAX_FILAS) throw error(422, `Maximo ${MAX_FILAS} filas por archivo`);
  const faltan = requeridas.filter((c) => !(c in filas[0]));
  if (faltan.length) throw error(422, `Faltan columnas: ${faltan.join(', ')}`);
  return { filas, hash: crypto.createHash('sha256').update(archivo.buffer).digest('hex') };
}

async function bitacora(repo, empresaId, tipo, archivo, hash, resultado) {
  return repo.insertar('importacion', {
    empresa_id: empresaId, tipo, archivo_nombre: String(archivo.originalname || 'archivo.csv').slice(0, 255), archivo_hash: hash,
    filas: resultado.length, aplicadas: resultado.filter((r) => r.aplicada).length, resultado,
  });
}

// ---- Nomina ----

/** Decide la accion de una fila frente al estado actual (sin escribir). */
function accionNomina(fila, persona, vinculacion) {
  if (fila.fecha_retiro) {
    if (!persona || !vinculacion) return { accion: 'omitir', detalle: 'Retiro de alguien sin vinculacion activa' };
    return { accion: 'retirar', detalle: `Retiro el ${fila.fecha_retiro}` };
  }
  if (!persona) return { accion: 'crear', detalle: `Ingreso el ${fila.fecha_ingreso}` };
  if (!vinculacion) return { accion: 'vincular', detalle: `Reingreso el ${fila.fecha_ingreso}` };
  return { accion: 'omitir', detalle: 'Ya esta vinculada' };
}

async function nomina(repo, empresaId, archivo, { aplicar = false } = {}, hoy = hoyBogota()) {
  const { filas, hash } = leer(archivo, ['tipo_documento', 'numero_documento', 'nombres', 'apellidos', 'fecha_ingreso']);
  const [cargos, centros] = await Promise.all([repo.listar('cargo', { empresa_id: empresaId, estado: 'activo' }), repo.listar('centro_trabajo', { empresa_id: empresaId })]);
  const cargoPorNombre = new Map(cargos.map((c) => [c.nombre.toLowerCase(), c.id]));
  const resultado = [];
  for (const f of filas) {
    const r = { fila: f._fila, documento: `${f.tipo_documento} ${f.numero_documento}`, nombre: `${f.nombres} ${f.apellidos}`, aplicada: false };
    try {
      const [persona] = await repo.listar('persona', { tipo_documento: f.tipo_documento.toUpperCase(), numero_documento: f.numero_documento });
      const [vinculacion] = persona ? await repo.listar('vinculacion', { empresa_id: empresaId, persona_id: persona.id, estado: 'activa' }) : [];
      Object.assign(r, accionNomina(f, persona, vinculacion));
      const cargoId = f.cargo ? cargoPorNombre.get(f.cargo.toLowerCase()) : null;
      if (f.cargo && !cargoId) r.advertencia = `Cargo "${f.cargo}" no existe: se vincula sin cargo`;
      const vinc = {
        tipo: f.tipo_vinculacion || 'dependiente', fecha_ingreso: f.fecha_ingreso, cargo_id: cargoId ? String(cargoId) : '',
        centro_trabajo_id: centros.length === 1 ? String(centros[0].id) : '',
      };
      if (aplicar && r.accion === 'crear') {
        await personas.crear(repo, empresaId, {
          tipo_documento: f.tipo_documento.toUpperCase(), numero_documento: f.numero_documento, nombres: f.nombres, apellidos: f.apellidos,
          sexo: f.sexo || null, fecha_nacimiento: f.fecha_nacimiento || null, email: f.email || null, vincular: '1', ...vinc,
        });
      } else if (aplicar && r.accion === 'vincular') {
        await personas.vincular(repo, empresaId, persona.id, vinc);
      } else if (aplicar && r.accion === 'retirar') {
        await personas.retirar(repo, empresaId, vinculacion.id, { fecha: f.fecha_retiro, motivo: f.motivo_retiro || 'Retiro reportado por nomina' }, hoy);
      }
      r.aplicada = aplicar && r.accion !== 'omitir';
    } catch (err) {
      if (!err.status) throw err;
      Object.assign(r, { accion: 'error', detalle: err.message });
    }
    resultado.push(r);
  }
  if (aplicar) await bitacora(repo, empresaId, 'nomina', archivo, hash, resultado);
  return resultado;
}

// ---- PILA ----

async function pila(repo, empresaId, archivo, { aplicar = false } = {}, hoy = hoyBogota()) {
  const { filas, hash } = leer(archivo, COLUMNAS_PILA);
  const lista = await repo.listar('contratista', { empresa_id: empresaId });
  const porNit = new Map(lista.map((c) => [c.nit, c]));
  const resultado = [];
  for (const f of filas) {
    const r = { fila: f._fila, documento: f.numero_documento, contratista: f.nit_contratista, periodo: f.periodo, aplicada: false };
    try {
      const c = porNit.get(f.nit_contratista.replace(/[.\-\s]/g, ''));
      if (!c) throw error(422, 'Contratista no registrado');
      const [persona] = await repo.listar('persona', { numero_documento: f.numero_documento });
      if (!persona) throw error(422, 'Persona no registrada');
      const [t] = await repo.listar('contratista_trabajador', { contratista_id: c.id, persona_id: persona.id, estado: 'activo' });
      if (!t) throw error(422, 'No es trabajador activo del contratista');
      const clase = String(f.clase_riesgo).toUpperCase();
      r.resultado = contratistas.claseCorrecta(clase, c.clase_riesgo) ? 'conforme' : 'inconsistente';
      r.detalle = r.resultado === 'conforme' ? `Clase ${clase}` : `Cotiza clase ${clase}, la actividad es ${c.clase_riesgo}`;
      if (aplicar) {
        await contratistas.verificarSgrl(repo, empresaId, c.id, {
          persona_id: String(persona.id), periodo: f.periodo, planilla: f.planilla, arl: f.arl, fecha_pago: f.fecha_pago, clase_cotizada: clase,
        }, hoy);
        r.aplicada = true;
      }
    } catch (err) {
      if (!err.status) throw err;
      Object.assign(r, { resultado: 'error', detalle: err.message });
    }
    resultado.push(r);
  }
  if (aplicar) await bitacora(repo, empresaId, 'pila', archivo, hash, resultado);
  return resultado;
}

// ---- FURAT ----

/** Datos del FURAT (Res. 156/2005) en CSV para cargar o transcribir en el portal de la ARL. */
async function furat(repo, empresaId, eventoId) {
  const e = await repo.obtener('evento', eventoId);
  if (!e || e.empresa_id !== empresaId) throw error(404, 'Evento no encontrado');
  if (e.tipo === 'incidente') throw error(422, 'Los incidentes no se reportan con FURAT');
  const [empresa, persona, centro] = await Promise.all([
    repo.obtener('empresa', empresaId),
    e.persona_id ? repo.obtener('persona', e.persona_id) : null,
    e.centro_trabajo_id ? repo.obtener('centro_trabajo', e.centro_trabajo_id) : null,
  ]);
  const [v] = persona ? await repo.consultar(
    `SELECT v.tipo, v.fecha_ingreso, c.nombre AS cargo FROM vinculacion v LEFT JOIN cargo c ON c.tenant_id = {tenant} AND c.id = v.cargo_id
      WHERE v.tenant_id = {tenant} AND v.empresa_id = ? AND v.persona_id = ? ORDER BY v.fecha_ingreso DESC LIMIT 1`, [empresaId, persona.id],
  ) : [];
  const [fechaEvento, horaEvento] = textoBogota(e.fecha_ocurrencia).split(' ');
  const filas = [
    ['seccion', 'campo', 'valor'],
    ['empleador', 'nit', `${empresa.nit}-${empresa.digito_verificacion || ''}`],
    ['empleador', 'razon_social', empresa.razon_social],
    ['empleador', 'centro_trabajo', centro ? centro.nombre : ''],
    ['empleador', 'clase_riesgo_centro', centro ? centro.clase_riesgo : ''],
    ['trabajador', 'tipo_documento', persona ? persona.tipo_documento : ''],
    ['trabajador', 'numero_documento', persona ? persona.numero_documento : ''],
    ['trabajador', 'nombres', persona ? persona.nombres : ''],
    ['trabajador', 'apellidos', persona ? persona.apellidos : ''],
    ['trabajador', 'sexo', persona ? persona.sexo || '' : ''],
    ['trabajador', 'fecha_nacimiento', persona ? persona.fecha_nacimiento || '' : ''],
    ['trabajador', 'tipo_vinculacion', v ? v.tipo : ''],
    ['trabajador', 'cargo', v ? v.cargo || '' : ''],
    ['trabajador', 'fecha_ingreso', v ? v.fecha_ingreso : ''],
    ['evento', 'codigo_interno', e.codigo],
    ['evento', 'tipo', e.tipo],
    ['evento', 'gravedad', e.gravedad || ''],
    ['evento', 'fecha', fechaEvento],
    ['evento', 'hora', horaEvento],
    ['evento', 'lugar', e.lugar || ''],
    ['evento', 'tipo_lesion', e.tipo_lesion || ''],
    ['evento', 'parte_cuerpo', e.parte_cuerpo || ''],
    ['evento', 'agente', e.agente_lesion || ''],
    ['evento', 'dias_incapacidad', e.dias_incapacidad ?? ''],
    ['evento', 'descripcion', e.descripcion],
  ];
  await repo.auditar('exportar', 'evento', e.id, null, { formato: 'furat_csv' });
  return { nombre: `furat-${e.codigo}.csv`, contenido: csv.generar(filas) };
}

async function historial(repo, empresaId) {
  return repo.consultar(
    'SELECT id, tipo, archivo_nombre, archivo_hash, filas, aplicadas, creado_en FROM importacion WHERE tenant_id = {tenant} AND empresa_id = ? ORDER BY id DESC LIMIT 50', [empresaId],
  );
}

module.exports = { COLUMNAS_NOMINA, COLUMNAS_PILA, accionNomina, nomina, pila, furat, historial };
