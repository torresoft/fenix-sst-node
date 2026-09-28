// Menu lateral agrupado por el ciclo PHVA del SG-SST. roles: quienes ven la opcion (null = todos).
const { ROLES_VER, ROLES_GESTIONAR } = require('./rutas');

const SST = ROLES_VER;
const GRUPOS = [
  {
    titulo: null,
    items: [
      { ruta: '/', texto: 'Inicio', icono: 'fa-home', roles: SST, exacta: true },
      { ruta: '/mis-empresas', texto: 'Mis empresas', icono: 'fa-briefcase', roles: SST },
      { ruta: '/obligaciones', texto: 'Obligaciones y plazos', icono: 'fa-clock', roles: SST },
      { ruta: '/acciones', texto: 'Acciones de mejora', icono: 'fa-tools', roles: SST },
    ],
  },
  {
    titulo: 'Planear', icono: 'fa-drafting-compass',
    items: [
      { ruta: '/empresa', texto: 'Empresa y centros', icono: 'fa-building', roles: SST },
      { ruta: '/personas', texto: 'Personas', icono: 'fa-users', roles: SST },
      { ruta: '/matriz-legal', texto: 'Matriz legal', icono: 'fa-balance-scale', roles: SST },
      { ruta: '/peligros', texto: 'Peligros y riesgos', icono: 'fa-exclamation-triangle', roles: SST },
      { ruta: '/planeacion', texto: 'Plan anual y cambios', icono: 'fa-calendar-alt', roles: SST },
      { ruta: '/documentos', texto: 'Documentos', icono: 'fa-folder-open', roles: SST },
    ],
  },
  {
    titulo: 'Hacer', icono: 'fa-hard-hat',
    items: [
      { ruta: '/formacion', texto: 'Formación', icono: 'fa-graduation-cap', roles: SST },
      { ruta: '/salud', texto: 'Salud ocupacional', icono: 'fa-heartbeat', roles: SST },
      { ruta: '/epp', texto: 'EPP', icono: 'fa-mitten', roles: SST },
      { ruta: '/inspecciones', texto: 'Inspecciones', icono: 'fa-clipboard-check', roles: SST },
      { ruta: '/emergencias', texto: 'Emergencias', icono: 'fa-fire-extinguisher', roles: SST },
      { ruta: '/permisos', texto: 'Permisos de alto riesgo', icono: 'fa-file-signature', roles: SST },
      { ruta: '/contratistas', texto: 'Contratistas', icono: 'fa-handshake', roles: SST },
      { ruta: '/comites', texto: 'Comités', icono: 'fa-people-arrows', roles: [...SST, 'convivencia'] },
      { ruta: '/convivencia', texto: 'Convivencia y salud mental', icono: 'fa-user-shield', roles: [...SST, 'convivencia'] },
      { ruta: '/pesv', texto: 'Seguridad vial', icono: 'fa-truck', roles: SST },
      { ruta: '/quimicos', texto: 'Productos químicos', icono: 'fa-flask', roles: SST },
    ],
  },
  {
    titulo: 'Verificar', icono: 'fa-search',
    items: [
      { ruta: '/eventos', texto: 'Incidentes, AT y EL', icono: 'fa-first-aid', roles: SST },
      { ruta: '/indicadores', texto: 'Indicadores', icono: 'fa-chart-line', roles: SST },
      { ruta: '/autoevaluacion', texto: 'Autoevaluación 0312', icono: 'fa-tasks', roles: SST },
    ],
  },
  {
    titulo: 'Herramientas', icono: 'fa-toolbox',
    items: [
      { ruta: '/expediente', texto: 'Expediente para inspección', icono: 'fa-file-archive', roles: SST.filter((r) => r !== 'copasst') },
      { ruta: '/consentimientos', texto: 'Autorizaciones de datos', icono: 'fa-user-lock', roles: SST },
      { ruta: '/integraciones', texto: 'Integraciones', icono: 'fa-exchange-alt', roles: ROLES_GESTIONAR },
      { ruta: '/empresa/usuarios', texto: 'Usuarios de la empresa', icono: 'fa-user-cog', roles: ['admin_tenant'] },
    ],
  },
  {
    titulo: 'Plataforma', icono: 'fa-server',
    items: [
      { ruta: '/plataforma/clientes', texto: 'Clientes', icono: 'fa-city', roles: ['superadmin'] },
      { ruta: '/plataforma/suscripciones', texto: 'Suscripciones', icono: 'fa-file-invoice-dollar', roles: ['superadmin'] },
      { ruta: '/plataforma/usuarios', texto: 'Usuarios', icono: 'fa-users-cog', roles: ['superadmin'] },
      { ruta: '/plataforma/catalogos', texto: 'Catálogos', icono: 'fa-book', roles: ['superadmin'] },
    ],
  },
  {
    titulo: 'Mi espacio', icono: 'fa-user',
    items: [
      { ruta: '/mis-registros', texto: 'Mis registros', icono: 'fa-id-card', roles: null },
      { ruta: '/firmas', texto: 'Mis firmas', icono: 'fa-signature', roles: null },
    ],
  },
];

const coincide = (item, ruta) => (item.exacta ? ruta === item.ruta : ruta === item.ruta || ruta.startsWith(`${item.ruta}/`));

// Opcion mas especifica que coincide con la ruta (/empresa/usuarios gana sobre /empresa).
function masEspecifica(ruta) {
  let mejor = null;
  for (const g of GRUPOS) {
    for (const i of g.items) if (coincide(i, ruta) && (!mejor || i.ruta.length > mejor.i.ruta.length)) mejor = { g, i };
  }
  return mejor;
}

/** Menu visible para los roles del usuario, con la opcion activa y el grupo abierto. */
function menu(roles, ruta) {
  const actual = masEspecifica(ruta);
  return GRUPOS.map((g) => {
    const items = g.items.filter((i) => !i.roles || i.roles.some((r) => roles.includes(r))).map((i) => ({ ...i, activa: Boolean(actual) && actual.i === i }));
    return { ...g, items, abierto: items.some((i) => i.activa) };
  }).filter((g) => g.items.length);
}

/** Miga de pan: grupo y opcion de la ruta actual. */
function miga(ruta) {
  const m = masEspecifica(ruta);
  return m ? { grupo: m.g.titulo, texto: m.i.texto, ruta: m.i.ruta } : null;
}

module.exports = { GRUPOS, menu, miga };
