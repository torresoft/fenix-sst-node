// Titulos: admiten entidades HTML en el texto fijo; se decodifican y luego se escapan al imprimir,
// asi un dato de usuario dentro del titulo nunca se interpreta como HTML.
const ENTIDADES = {
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', iquest: '¿', iexcl: '¡', middot: '·', ndash: '–', mdash: '—', amp: '&', nbsp: ' ',
};

const textoPlano = (s) => String(s ?? '').replace(/&([a-zA-Z]+);/g, (m, n) => ENTIDADES[n] ?? m);

/** Pesos colombianos desde un DECIMAL en texto: 1200000.50 -> $1.200.000,50 (sin pasar por Number). */
function pesos(v) {
  const [e, d] = String(v ?? 0).split('.');
  return `$${e.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${d && /[1-9]/.test(d) ? `,${d}` : ''}`;
}

module.exports = { textoPlano, pesos };
