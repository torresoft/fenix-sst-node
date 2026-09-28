-- M10: COPASST, Vigia y Comite de Convivencia. Requiere 01 a 09.

CREATE TABLE comite_tipo (
  codigo             VARCHAR(20)  NOT NULL PRIMARY KEY,
  nombre             VARCHAR(100) NOT NULL,
  norma_codigo       VARCHAR(40)  NOT NULL,
  trabajadores_min   INT UNSIGNED NULL,
  trabajadores_max   INT UNSIGNED NULL,
  vencimiento_codigo VARCHAR(40)  NOT NULL,
  documento_tipo     VARCHAR(60)  NOT NULL,
  quorum             VARCHAR(30)  NULL,
  periodicidad_meses TINYINT UNSIGNED NOT NULL DEFAULT 1,
  conformacion       JSON NULL,
  estado             ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual  TINYINT(1) NOT NULL DEFAULT 0,
  creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por    BIGINT UNSIGNED NULL,
  CONSTRAINT fk_ctp_venc FOREIGN KEY (vencimiento_codigo) REFERENCES vencimiento_recurrente (codigo),
  CONSTRAINT fk_ctp_doc  FOREIGN KEY (documento_tipo)     REFERENCES tipo_documental (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Un registro por periodo de 2 anios. El nuevo periodo reemplaza al anterior.
CREATE TABLE comite (
  id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id              BIGINT UNSIGNED NOT NULL,
  empresa_id             BIGINT UNSIGNED NOT NULL,
  tipo                   VARCHAR(20) NOT NULL,
  periodo_inicio         DATE NOT NULL,
  periodo_fin            DATE NOT NULL,
  trabajadores_base      INT UNSIGNED NOT NULL,
  acta_documento_id      BIGINT UNSIGNED NULL,
  observacion            VARCHAR(500) NULL,
  estado                 ENUM('vigente','reemplazado','anulado') NOT NULL DEFAULT 'vigente',
  creado_por             BIGINT UNSIGNED NULL,
  creado_en              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en         DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_empresa_tipo (tenant_id, empresa_id, tipo, estado),
  CONSTRAINT fk_com_empresa FOREIGN KEY (tenant_id, empresa_id)        REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_com_tipo    FOREIGN KEY (tipo)                         REFERENCES comite_tipo (codigo),
  CONSTRAINT fk_com_acta    FOREIGN KEY (tenant_id, acta_documento_id) REFERENCES documento_sst (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE comite_miembro (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  comite_id       BIGINT UNSIGNED NOT NULL,
  persona_id      BIGINT UNSIGNED NOT NULL,
  representacion  ENUM('empleador','trabajadores') NOT NULL,
  calidad         ENUM('principal','suplente') NOT NULL,
  cargo_comite    ENUM('presidente','secretario','miembro') NOT NULL DEFAULT 'miembro',
  fecha_ingreso   DATE NOT NULL,
  fecha_retiro    DATE NULL,
  motivo_retiro   VARCHAR(255) NULL,
  estado          ENUM('activo','retirado') NOT NULL DEFAULT 'activo',
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_comite (tenant_id, comite_id, estado),
  CONSTRAINT fk_cm_comite  FOREIGN KEY (tenant_id, comite_id)  REFERENCES comite (tenant_id, id),
  CONSTRAINT fk_cm_persona FOREIGN KEY (tenant_id, persona_id) REFERENCES persona (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE comite_sesion (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id          BIGINT UNSIGNED NOT NULL,
  comite_id          BIGINT UNSIGNED NOT NULL,
  tipo               ENUM('ordinaria','extraordinaria') NOT NULL,
  fecha              DATE NOT NULL,
  evento_id          BIGINT UNSIGNED NULL,
  temas              TEXT NOT NULL,
  asistentes         INT UNSIGNED NOT NULL,
  principales        INT UNSIGNED NOT NULL,
  quorum             TINYINT(1) NULL,
  acta_documento_id  BIGINT UNSIGNED NULL,
  observacion        VARCHAR(500) NULL,
  estado             ENUM('realizada','con_acta','anulada') NOT NULL DEFAULT 'realizada',
  creado_por         BIGINT UNSIGNED NULL,
  creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_comite_fecha (tenant_id, comite_id, fecha),
  CONSTRAINT fk_cs_comite FOREIGN KEY (tenant_id, comite_id)         REFERENCES comite (tenant_id, id),
  CONSTRAINT fk_cs_evento FOREIGN KEY (tenant_id, evento_id)         REFERENCES evento (tenant_id, id),
  CONSTRAINT fk_cs_acta   FOREIGN KEY (tenant_id, acta_documento_id) REFERENCES documento_sst (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE comite_asistencia (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  sesion_id   BIGINT UNSIGNED NOT NULL,
  miembro_id  BIGINT UNSIGNED NOT NULL,
  creado_por  BIGINT UNSIGNED NULL,
  creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sesion_miembro (tenant_id, sesion_id, miembro_id),
  CONSTRAINT fk_ca_sesion  FOREIGN KEY (tenant_id, sesion_id)  REFERENCES comite_sesion (tenant_id, id),
  CONSTRAINT fk_ca_miembro FOREIGN KEY (tenant_id, miembro_id) REFERENCES comite_miembro (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE comite_compromiso (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id           BIGINT UNSIGNED NOT NULL,
  comite_id           BIGINT UNSIGNED NOT NULL,
  sesion_id           BIGINT UNSIGNED NOT NULL,
  descripcion         VARCHAR(1000) NOT NULL,
  responsable         VARCHAR(150) NOT NULL,
  fecha_limite        DATE NOT NULL,
  fecha_cumplimiento  DATE NULL,
  observacion         VARCHAR(1000) NULL,
  estado              ENUM('abierto','cumplido','anulado') NOT NULL DEFAULT 'abierto',
  creado_por          BIGINT UNSIGNED NULL,
  creado_en           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en      DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_comite_estado (tenant_id, comite_id, estado),
  CONSTRAINT fk_cc_comite FOREIGN KEY (tenant_id, comite_id) REFERENCES comite (tenant_id, id),
  CONSTRAINT fk_cc_sesion FOREIGN KEY (tenant_id, sesion_id) REFERENCES comite_sesion (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

CREATE TRIGGER trg_comite_bu BEFORE UPDATE ON comite FOR EACH ROW
BEGIN
  IF OLD.estado <> 'vigente' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'comite de un periodo cerrado: no admite cambios';
  END IF;
  IF NOT (OLD.tipo <=> NEW.tipo AND OLD.periodo_inicio <=> NEW.periodo_inicio AND OLD.periodo_fin <=> NEW.periodo_fin) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'comite: tipo y periodo son inmutables';
  END IF;
END$$

CREATE TRIGGER trg_comite_bd BEFORE DELETE ON comite FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'comite no se borra';
END$$

CREATE TRIGGER trg_comite_miembro_bu BEFORE UPDATE ON comite_miembro FOR EACH ROW
BEGIN
  IF OLD.estado = 'retirado' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'miembro retirado: no admite cambios';
  END IF;
END$$

CREATE TRIGGER trg_comite_miembro_bd BEFORE DELETE ON comite_miembro FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'comite_miembro no se borra: retire';
END$$

-- La sesion (fecha, temas, asistencia) es un hecho: solo cambia al adjuntar el acta o al anularse.
CREATE TRIGGER trg_comite_sesion_bu BEFORE UPDATE ON comite_sesion FOR EACH ROW
BEGIN
  IF OLD.estado = 'anulada' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sesion anulada';
  END IF;
  IF NOT (OLD.fecha <=> NEW.fecha AND OLD.temas <=> NEW.temas AND OLD.asistentes <=> NEW.asistentes
      AND OLD.quorum <=> NEW.quorum AND OLD.tipo <=> NEW.tipo) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sesion: fecha, temas y asistencia son inmutables';
  END IF;
  IF OLD.acta_documento_id IS NOT NULL AND NOT (OLD.acta_documento_id <=> NEW.acta_documento_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sesion: el acta ya fue asociada';
  END IF;
END$$

CREATE TRIGGER trg_comite_sesion_bd BEFORE DELETE ON comite_sesion FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'comite_sesion no se borra: anule';
END$$

CREATE TRIGGER trg_comite_asistencia_bu BEFORE UPDATE ON comite_asistencia FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'comite_asistencia es inmutable';
END$$

CREATE TRIGGER trg_comite_asistencia_bd BEFORE DELETE ON comite_asistencia FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'comite_asistencia es inmutable';
END$$

CREATE TRIGGER trg_comite_compromiso_bu BEFORE UPDATE ON comite_compromiso FOR EACH ROW
BEGIN
  IF OLD.estado <> 'abierto' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'compromiso cerrado';
  END IF;
END$$

CREATE TRIGGER trg_comite_compromiso_bd BEFORE DELETE ON comite_compromiso FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'comite_compromiso no se borra: anule';
END$$

DELIMITER ;
