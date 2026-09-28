// Aprovisiona un tenant con su primera empresa y usuario administrador.
// Si el correo ya existe (p. ej. un consultor), se le asigna el rol en el tenant nuevo.
// Uso: node scripts/alta-tenant.js
const crypto = require('crypto');
const readline = require('readline/promises');
const config = require('../src/config');
const { hashear } = require('../src/auth/password');
const { crearTenantConAdmin } = require('../src/db/cuentas');
const { cerrar } = require('../src/db/carga-catalogos');

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const preguntar = async (texto, { obligatorio = true, defecto = '' } = {}) => {
    for (;;) {
      const r = (await rl.question(`${texto}${defecto ? ` [${defecto}]` : ''}: `)).trim() || defecto;
      if (r || !obligatorio) return r;
    }
  };

  try {
    const tenant = { nombre: await preguntar('Nombre del tenant (cuenta)') };
    const empresa = {
      razonSocial: await preguntar('Razon social de la empresa', { defecto: tenant.nombre }),
      nit: (await preguntar('NIT (sin DV)')).replace(/\D/g, ''),
      dv: await preguntar('Digito de verificacion', { obligatorio: false }),
      numeroTrabajadores: Number.parseInt(await preguntar('Numero de trabajadores', { defecto: '0' }), 10) || 0,
    };
    const usuario = {
      email: await preguntar('Correo del administrador'),
      nombres: await preguntar('Nombres'),
      apellidos: await preguntar('Apellidos'),
      tipoDocumento: (await preguntar('Tipo de documento', { defecto: 'CC' })).toUpperCase(),
      numeroDocumento: await preguntar('Numero de documento'),
    };

    const temporal = crypto.randomBytes(9).toString('base64url');
    const r = await crearTenantConAdmin({
      tenant, empresa, usuario, passwordHash: await hashear(temporal), regionDatos: config.regionDatos,
    });

    console.info(`\nTenant ${r.tenantId} / empresa ${r.empresaId} creados.`);
    if (r.usuarioExistente) console.info(`Usuario existente ${usuario.email}: se le asigno admin_tenant; conserva su contrasena.`);
    else console.info(`Usuario ${usuario.email} creado. Contrasena temporal (se exige cambio al ingresar): ${temporal}`);
  } finally {
    rl.close();
    await cerrar();
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
