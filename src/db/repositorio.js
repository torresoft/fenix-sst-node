// Unico punto de acceso a datos de tenant. El tenant_id se fija al construir y se aplica
// en cada operacion; no existe metodo para borrar.
const pool = require('./pool');
const g = require('./guardia-sql');
const { INMUTABLES, SIN_CREADO_POR } = require('./tablas');
const { registrarAuditoria } = require('./auditoria');

const PROTEGIDAS = new Set(['id', 'tenant_id', 'creado_por', 'creado_en']);

function serializar(valor) {
  if (valor !== null && typeof valor === 'object' && !(valor instanceof Date) && !Buffer.isBuffer(valor)) {
    return JSON.stringify(valor);
  }
  return valor === undefined ? null : valor;
}

class RepositorioTenant {
  /**
   * @param {number} tenantId
   * @param {object} actor { id, nombre, ip, userAgent }
   * @param {object} [ejecutor] conexion transaccional (uso interno)
   */
  constructor(tenantId, actor, ejecutor = pool) {
    this.tenantId = g.validarTenantId(tenantId);
    if (!actor || !actor.nombre) throw new Error('RepositorioTenant requiere actor');
    this.actor = actor;
    this.ejecutor = ejecutor;
    Object.freeze(this);
  }

  /** SELECT con marcas {tenant} (una por cada tabla de tenant). */
  async consultar(sql, params = []) {
    const [filas] = await this.ejecutor.execute(g.prepararConsultaTenant(sql, this.tenantId), params);
    return filas;
  }

  async obtener(tabla, id) {
    g.tablaTenant(tabla);
    const [filas] = await this.ejecutor.execute(
      `SELECT * FROM ${tabla} WHERE tenant_id = ? AND id = ?`, [this.tenantId, id],
    );
    return filas[0] || null;
  }

  /** Igualdad simple sobre columnas; opciones: { orden: 'col [ASC|DESC]', limite, bloquear (FOR UPDATE, dentro de transaccion) } */
  async listar(tabla, filtros = {}, opciones = {}) {
    g.tablaTenant(tabla);
    const cols = Object.keys(filtros).map(g.identificador);
    if (cols.includes('tenant_id')) throw new Error('tenant_id no se filtra manualmente');
    let sql = `SELECT * FROM ${tabla} WHERE tenant_id = ?`;
    const params = [this.tenantId];
    for (const c of cols) {
      if (filtros[c] === null) sql += ` AND ${c} IS NULL`;
      else { sql += ` AND ${c} = ?`; params.push(filtros[c]); }
    }
    if (opciones.orden) {
      const [col, dir = 'ASC'] = String(opciones.orden).trim().split(/\s+/);
      if (!/^(asc|desc)$/i.test(dir)) throw new Error('Direccion de orden invalida');
      sql += ` ORDER BY ${g.identificador(col)} ${dir.toUpperCase()}`;
    }
    if (opciones.limite) sql += ` LIMIT ${Math.max(1, Math.min(Number.parseInt(opciones.limite, 10) || 1, 1000))}`;
    if (opciones.bloquear) sql += ' FOR UPDATE';
    const [filas] = await this.ejecutor.execute(sql, params);
    return filas;
  }

  /** Inserta forzando tenant_id y creado_por; audita 'crear'. Devuelve el id. */
  async insertar(tabla, datos, { auditar = true } = {}) {
    g.tablaTenant(tabla);
    if (tabla === 'auditoria_log') throw new Error('Use registrarAuditoria()');
    const fila = { ...datos, tenant_id: this.tenantId };
    delete fila.id;
    if (!SIN_CREADO_POR.has(tabla) && fila.creado_por == null) fila.creado_por = this.actor.id ?? null;
    const cols = Object.keys(fila).map(g.identificador);
    const [res] = await this.ejecutor.execute(
      `INSERT INTO ${tabla} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => serializar(fila[c])),
    );
    if (auditar) await this.auditar('crear', tabla, res.insertId, null, fila);
    return res.insertId;
  }

  /** Actualiza con bloqueo de fila y audita antes/despues. Las tablas inmutables lo rechazan. */
  async actualizar(tabla, id, cambios, { accion = 'actualizar', auditar = true } = {}) {
    g.tablaTenant(tabla);
    if (INMUTABLES.has(tabla)) throw new Error(`${tabla} es inmutable`);
    const cols = Object.keys(cambios).map(g.identificador).filter((c) => !PROTEGIDAS.has(c));
    if (cols.length === 0) throw new Error('Sin cambios que aplicar');

    return this.transaccion(async (tx) => {
      const [previas] = await tx.ejecutor.execute(
        `SELECT * FROM ${tabla} WHERE tenant_id = ? AND id = ? FOR UPDATE`, [tx.tenantId, id],
      );
      if (previas.length === 0) throw new Error(`${tabla} ${id} no existe en este tenant`);
      const antes = {};
      const despues = {};
      for (const c of cols) { antes[c] = previas[0][c]; despues[c] = cambios[c]; }
      await tx.ejecutor.execute(
        `UPDATE ${tabla} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE tenant_id = ? AND id = ?`,
        [...cols.map((c) => serializar(cambios[c])), tx.tenantId, id],
      );
      if (auditar) await tx.auditar(accion, tabla, id, antes, despues);
      return true;
    });
  }

  auditar(accion, entidad, entidadId, antes = null, despues = null) {
    return registrarAuditoria(
      { tenantId: this.tenantId, actor: this.actor, accion, entidad, entidadId, antes, despues },
      this.ejecutor,
    );
  }

  /** Ejecuta fn(repoTx) en una transaccion. Anidada reutiliza la actual. */
  async transaccion(fn) {
    if (this.ejecutor !== pool) return fn(this);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const resultado = await fn(new RepositorioTenant(this.tenantId, this.actor, conn));
      await conn.commit();
      return resultado;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

module.exports = { RepositorioTenant };
