// Calculo de plazos legales contra el calendario de festivos. Trabaja con fechas 'YYYY-MM-DD'
// en UTC puro para no depender de la zona horaria del proceso.
const DIA_MS = 86400000;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

class ErrorCobertura extends Error {}

/** Fecha de hoy en America/Bogota como 'YYYY-MM-DD'. */
function hoyBogota(ahora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(ahora);
}

function normalizar(fecha) {
  if (fecha instanceof Date) return hoyBogota(fecha);
  const s = String(fecha).slice(0, 10);
  if (!RE_FECHA.test(s)) throw new Error(`Fecha invalida: ${fecha}`);
  const [a, m, d] = s.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) throw new Error(`Fecha invalida: ${fecha}`);
  return s;
}

const aMs = (s) => Date.parse(`${s}T00:00:00Z`);
const aTexto = (ms) => new Date(ms).toISOString().slice(0, 10);
const sumarDias = (s, n) => aTexto(aMs(s) + n * DIA_MS);

function sumarMeses(s, n) {
  const [a, m, d] = s.split('-').map(Number);
  const destino = new Date(Date.UTC(a, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate();
  destino.setUTCDate(Math.min(d, ultimo));
  return aTexto(destino.getTime());
}

class Calendario {
  /** @param {string[]} festivos fechas 'YYYY-MM-DD' */
  constructor(festivos) {
    if (!Array.isArray(festivos) || festivos.length === 0) throw new Error('Calendario sin festivos cargados');
    this.festivos = new Set(festivos.map(normalizar));
    const anios = [...this.festivos].map((f) => Number(f.slice(0, 4)));
    this.desde = `${Math.min(...anios)}-01-01`;
    this.hasta = `${Math.max(...anios)}-12-31`;
    Object.freeze(this);
  }

  verificarCobertura(s) {
    if (s < this.desde || s > this.hasta) {
      throw new ErrorCobertura(`Fecha ${s} fuera del calendario de festivos cargado (${this.desde} a ${this.hasta})`);
    }
  }

  esHabil(fecha) {
    const s = normalizar(fecha);
    this.verificarCobertura(s);
    const dia = new Date(aMs(s)).getUTCDay();
    return dia !== 0 && dia !== 6 && !this.festivos.has(s);
  }

  /** Dias habiles en el intervalo (desde, hasta]. Negativo si hasta < desde. */
  diasHabiles(desde, hasta) {
    let a = normalizar(desde);
    let b = normalizar(hasta);
    let signo = 1;
    if (b < a) { [a, b] = [b, a]; signo = -1; }
    let n = 0;
    for (let d = sumarDias(a, 1); d <= b; d = sumarDias(d, 1)) if (this.esHabil(d)) n++;
    return signo * n;
  }

  siguienteHabil(fecha) {
    let d = normalizar(fecha);
    while (!this.esHabil(d)) d = sumarDias(d, 1);
    return d;
  }

  /**
   * Fecha limite de un plazo. El conteo empieza el dia siguiente a fechaBase.
   * tipo: 'habil' | 'calendario' | 'mes'
   * correrSiInhabil: si un vencimiento calendario/mes cae en dia inhabil, se corre al siguiente habil.
   */
  sumarPlazo(fechaBase, cantidad, tipo, { correrSiInhabil = false } = {}) {
    const base = normalizar(fechaBase);
    if (!Number.isInteger(cantidad) || cantidad < 0) throw new Error(`Cantidad de plazo invalida: ${cantidad}`);

    if (tipo === 'habil') {
      this.verificarCobertura(base);
      let d = base;
      for (let n = 0; n < cantidad;) {
        d = sumarDias(d, 1);
        if (this.esHabil(d)) n++;
      }
      return d;
    }

    let limite;
    if (tipo === 'calendario') limite = sumarDias(base, cantidad);
    else if (tipo === 'mes') limite = sumarMeses(base, cantidad);
    else throw new Error(`Tipo de plazo desconocido: ${tipo}`);
    return correrSiInhabil ? this.siguienteHabil(limite) : limite;
  }

  /** 'cumplido' | 'vencido' | 'por_vencer' | 'en_termino' */
  estadoPlazo(fechaLimite, hoy = hoyBogota(), diasAlerta = 3, fechaCumplimiento = null) {
    if (fechaCumplimiento) return 'cumplido';
    const limite = normalizar(fechaLimite);
    const h = normalizar(hoy);
    if (h > limite) return 'vencido';
    const restantes = Math.round((aMs(limite) - aMs(h)) / DIA_MS);
    return restantes <= diasAlerta ? 'por_vencer' : 'en_termino';
  }
}

/** 'YYYY-MM-DD HH:MM' en hora de Bogota (los DATETIME llegan como Date). */
function textoBogota(fecha) {
  if (!fecha) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(fecha)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

module.exports = { Calendario, ErrorCobertura, hoyBogota, normalizar, sumarMeses, sumarDias, textoBogota };
