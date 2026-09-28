-- Suscripciones de los clientes (plataforma, no datos SST). Requiere 01 a 20.
-- Renovar = fila nueva; la anterior queda 'renovada'. Pagos registrados a mano: no se borran, se anulan.

-- suspendido_en: suspension automatica por falta de renovacion, una sola vez (si el superadmin reactiva, se respeta).
CREATE TABLE suscripcion (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  plan_codigo     VARCHAR(30)  NOT NULL,
  periodicidad    ENUM('mensual','trimestral','semestral','anual') NOT NULL,
  fecha_inicio    DATE NOT NULL,
  fecha_fin       DATE NOT NULL,
  valor           DECIMAL(14,2) NOT NULL DEFAULT 0,
  es_prueba       TINYINT(1) NOT NULL DEFAULT 0,
  observacion     VARCHAR(500) NULL,
  estado          ENUM('vigente','vencida','renovada','cancelada') NOT NULL DEFAULT 'vigente',
  motivo_estado   VARCHAR(500) NULL,
  suspendido_en   DATE NULL,
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tenant (tenant_id, estado, fecha_fin),
  KEY idx_fin (estado, fecha_fin),
  CONSTRAINT fk_sus_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (id),
  CONSTRAINT ck_sus_fechas CHECK (fecha_fin >= fecha_inicio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE suscripcion_pago (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  suscripcion_id  BIGINT UNSIGNED NOT NULL,
  fecha           DATE NOT NULL,
  valor           DECIMAL(14,2) NOT NULL,
  medio           VARCHAR(40)  NOT NULL,
  referencia      VARCHAR(100) NULL,
  observacion     VARCHAR(500) NULL,
  estado          ENUM('registrado','anulado') NOT NULL DEFAULT 'registrado',
  motivo_anulacion VARCHAR(500) NULL,
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_suscripcion (suscripcion_id, estado),
  KEY idx_fecha (fecha),
  CONSTRAINT fk_pago_sus FOREIGN KEY (suscripcion_id) REFERENCES suscripcion (id),
  CONSTRAINT ck_pago_valor CHECK (valor > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

CREATE TRIGGER trg_suscripcion_bd BEFORE DELETE ON suscripcion FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'suscripcion no se borra: cancele';
END$$

-- Una suscripcion cerrada no se reescribe: los datos pactados solo cambian mientras esta vigente.
CREATE TRIGGER trg_suscripcion_bu BEFORE UPDATE ON suscripcion FOR EACH ROW
BEGIN
  IF OLD.estado IN ('renovada','cancelada') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'suscripcion cerrada: no admite cambios';
  END IF;
END$$

CREATE TRIGGER trg_suscripcion_pago_bd BEFORE DELETE ON suscripcion_pago FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pago no se borra: anule';
END$$

CREATE TRIGGER trg_suscripcion_pago_bu BEFORE UPDATE ON suscripcion_pago FOR EACH ROW
BEGIN
  IF OLD.estado = 'anulado' OR NEW.valor <> OLD.valor OR NEW.fecha <> OLD.fecha OR NOT (NEW.suscripcion_id <=> OLD.suscripcion_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pago registrado: solo se anula';
  END IF;
END$$

DELIMITER ;
