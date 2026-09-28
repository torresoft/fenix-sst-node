// M17: reglas puras de quejas de convivencia y consolidado psicosocial.

const NIVELES = ['sin_riesgo', 'bajo', 'medio', 'alto', 'muy_alto'];
const CANALES = ['electronico', 'fisico', 'verbal'];
const CONDUCTAS = ['acoso_laboral', 'acoso_sexual', 'violencia', 'discriminacion', 'otra'];
const ACTUACIONES = ['citacion', 'reunion', 'audiencia', 'acuerdo', 'seguimiento', 'remision', 'anotacion'];
const RESULTADOS = ['acuerdo_conciliatorio', 'sin_acuerdo_remitida', 'desistimiento', 'no_competencia'];

const fecha = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null;
const texto = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const falla = (m) => Object.assign(new Error(m), { status: 422 });

function validarQueja(d, hoy) {
  const q = {
    canal: CANALES.includes(d.canal) ? d.canal : null,
    tipo_conducta: CONDUCTAS.includes(d.tipo_conducta) ? d.tipo_conducta : null,
    fecha_radicacion: fecha(d.fecha_radicacion) || hoy,
    quejoso_persona_id: Number.parseInt(d.quejoso_persona_id, 10) || null,
    quejoso_nombre: texto(d.quejoso_nombre, 150),
    implicados: texto(d.implicados, 500),
    hechos: texto(d.hechos, 20000),
    solicita_proteccion: d.solicita_proteccion === '1' ? 1 : 0,
  };
  if (!q.canal) throw falla('Canal de recepcion invalido');
  if (!q.tipo_conducta) throw falla('Tipo de conducta invalido');
  if (q.fecha_radicacion > hoy) throw falla('La fecha de radicacion no puede ser futura');
  if (!q.quejoso_persona_id && !q.quejoso_nombre) throw falla('Indique quien presenta la queja');
  if (!q.implicados) throw falla('Indique las personas implicadas');
  if (!q.hechos || q.hechos.length < 20) throw falla('Describa los hechos (minimo 20 caracteres)');
  if (q.solicita_proteccion) q.fecha_solicitud_proteccion = q.fecha_radicacion;
  return q;
}

const radicado = (anio, n) => `QC-${anio}-${String(n).padStart(4, '0')}`;

/** Grupos del consolidado: sin grupos por debajo del minimo y con total igual a los evaluados. */
function validarGrupos(grupos, evaluados, minimo) {
  if (!grupos.length) throw falla('Registre al menos un grupo del consolidado');
  const nombres = new Set();
  let suma = 0;
  for (const g of grupos) {
    if (!g.grupo) throw falla('Cada grupo requiere nombre (area o cargo)');
    if (nombres.has(g.grupo.toLowerCase())) throw falla(`Grupo repetido: ${g.grupo}`);
    nombres.add(g.grupo.toLowerCase());
    if (!Number.isSafeInteger(g.evaluados) || g.evaluados < minimo) {
      throw falla(`El grupo ${g.grupo} tiene menos de ${minimo} evaluados: agrupelo para no identificar personas`);
    }
    for (const c of ['intralaboral', 'extralaboral', 'estres']) if (!NIVELES.includes(g[c])) throw falla(`Nivel ${c} invalido en ${g.grupo}`);
    suma += g.evaluados;
  }
  if (suma !== evaluados) throw falla(`Los grupos suman ${suma} evaluados y el total es ${evaluados}`);
}

/** Alto y muy alto: anual; los demas: cada dos anios (Res. 2764/2022). */
const vencimientoPsicosocial = (nivel) => (['alto', 'muy_alto'].includes(nivel) ? 'PSICOSOCIAL_ALTO' : 'PSICOSOCIAL_MEDIO');

module.exports = {
  NIVELES, CANALES, CONDUCTAS, ACTUACIONES, RESULTADOS, fecha, texto, validarQueja, radicado, validarGrupos, vencimientoPsicosocial,
};
