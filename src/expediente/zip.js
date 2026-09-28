// Escritor ZIP minimo (metodo "store", sin compresion): suficiente para empaquetar el expediente.

const TABLA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = TABLA[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function fechaDos(fecha) {
  const d = fecha || new Date();
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const dia = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { hora, dia };
}

/** archivos: [{ nombre: 'carpeta/archivo.pdf', datos: Buffer }] -> Buffer ZIP. */
function crearZip(archivos, fecha = new Date()) {
  const { hora, dia } = fechaDos(fecha);
  const locales = [];
  const central = [];
  let offset = 0;
  for (const a of archivos) {
    const nombre = Buffer.from(a.nombre, 'utf8');
    const datos = Buffer.isBuffer(a.datos) ? a.datos : Buffer.from(String(a.datos), 'utf8');
    const crc = crc32(datos);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(datos.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    local.writeUInt16LE(0, 28);
    locales.push(local, nombre, datos);

    const cab = Buffer.alloc(46);
    cab.writeUInt32LE(0x02014b50, 0);
    cab.writeUInt16LE(20, 4);
    cab.writeUInt16LE(20, 6);
    cab.writeUInt16LE(0x0800, 8);
    cab.writeUInt16LE(0, 10);
    cab.writeUInt16LE(hora, 12);
    cab.writeUInt16LE(dia, 14);
    cab.writeUInt32LE(crc, 16);
    cab.writeUInt32LE(datos.length, 20);
    cab.writeUInt32LE(datos.length, 24);
    cab.writeUInt16LE(nombre.length, 28);
    cab.writeUInt32LE(offset, 42);
    central.push(cab, nombre);
    offset += 30 + nombre.length + datos.length;
  }
  const tamCentral = central.reduce((s, b) => s + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(tamCentral, 12);
  fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...locales, ...central, fin]);
}

/** Lee las entradas de un ZIP "store" (para pruebas y verificacion). */
function leerZip(zip) {
  const fin = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const total = zip.readUInt16LE(fin + 10);
  let p = zip.readUInt32LE(fin + 16);
  const entradas = [];
  for (let i = 0; i < total; i += 1) {
    const largoNombre = zip.readUInt16LE(p + 28);
    const tam = zip.readUInt32LE(p + 24);
    const crc = zip.readUInt32LE(p + 16);
    const offLocal = zip.readUInt32LE(p + 42);
    const nombre = zip.slice(p + 46, p + 46 + largoNombre).toString('utf8');
    const ln = zip.readUInt16LE(offLocal + 26);
    const datos = zip.slice(offLocal + 30 + ln, offLocal + 30 + ln + tam);
    entradas.push({ nombre, datos, crcOk: crc32(datos) === crc });
    p += 46 + largoNombre;
  }
  return entradas;
}

module.exports = { crc32, crearZip, leerZip };
