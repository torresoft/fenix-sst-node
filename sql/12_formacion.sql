-- M07: formacion y competencias. Requiere 01 a 11.

CREATE TABLE competencia_tipo (
  codigo               VARCHAR(30)  NOT NULL PRIMARY KEY,
  nombre               VARCHAR(150) NOT NULL,
  norma_codigo         VARCHAR(40)  NOT NULL,
  vencimiento_codigo   VARCHAR(40)  NULL,
  requerida_todos      TINYINT(1) NOT NULL DEFAULT 0,
  requiere_certificado TINYINT(1) NOT NULL DEFAULT 0,
  estado               ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual    TINYINT(1) NOT NULL DEFAULT 0,
  creado_en            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en       DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por      BIGINT UNSIGNED NULL,
  CONSTRAINT fk_ctipo_venc FOREIGN KEY (vencimiento_codigo) REFERENCES vencimiento_recurrente (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Competencias que exige cada cargo (ademas de las requeridas a todos).
CREATE TABLE cargo_competencia (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  cargo_id        BIGINT UNSIGNED NOT NULL,
  competencia     VARCHAR(30) NOT NULL,
  estado          ENUM('activo','retirado') NOT NULL DEFAULT 'activo',
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_cargo_comp (tenant_id, cargo_id, competencia),
  CONSTRAINT fk_cc2_cargo FOREIGN KEY (tenant_id, cargo_id) REFERENCES cargo (tenant_id, id),
  CONSTRAINT fk_cc2_tipo  FOREIGN KEY (competencia)         REFERENCES competencia_tipo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE capacitacion (
  id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id              BIGINT UNSIGNED NOT NULL,
  empresa_id             BIGINT UNSIGNED NOT NULL,
  tema                   VARCHAR(255) NOT NULL,
  competencia            VARCHAR(30) NULL,
  fecha                  DATE NOT NULL,
  horas                  DECIMAL(5,2) NOT NULL,
  instructor             VARCHAR(150) NULL,
  eficacia               VARCHAR(1000) NULL,
  registro_documento_id  BIGINT UNSIGNED NULL,
  observacion            VARCHAR(500) NULL,
  estado                 ENUM('programada','realizada','anulada') NOT NULL DEFAULT 'programada',
  creado_por             BIGINT UNSIGNED NULL,
  creado_en              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en         DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_empresa_fecha (tenant_id, empresa_id, fecha),
  CONSTRAINT fk_cap_empresa FOREIGN KEY (tenant_id, empresa_id)            REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_cap_tipo    FOREIGN KEY (competencia)                      REFERENCES competencia_tipo (codigo),
  CONSTRAINT fk_cap_doc     FOREIGN KEY (tenant_id, registro_documento_id) REFERENCES documento_sst (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE capacitacion_asistente (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id        BIGINT UNSIGNED NOT NULL,
  capacitacion_id  BIGINT UNSIGNED NOT NULL,
  persona_id       BIGINT UNSIGNED NOT NULL,
  aprobo           TINYINT(1) NOT NULL DEFAULT 1,
  creado_por       BIGINT UNSIGNED NULL,
  creado_en        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cap_persona (tenant_id, capacitacion_id, persona_id),
  CONSTRAINT fk_ca2_cap     FOREIGN KEY (tenant_id, capacitacion_id) REFERENCES capacitacion (tenant_id, id),
  CONSTRAINT fk_ca2_persona FOREIGN KEY (tenant_id, persona_id)      REFERENCES persona (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Competencia acreditada de una persona. Una renovacion crea otra y reemplaza la anterior.
CREATE TABLE competencia (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id          BIGINT UNSIGNED NOT NULL,
  empresa_id         BIGINT UNSIGNED NOT NULL,
  persona_id         BIGINT UNSIGNED NOT NULL,
  tipo               VARCHAR(30) NOT NULL,
  fecha_obtencion    DATE NOT NULL,
  fecha_vence        DATE NULL,
  entidad            VARCHAR(150) NULL,
  horas              DECIMAL(6,2) NULL,
  capacitacion_id    BIGINT UNSIGNED NULL,
  documento_id       BIGINT UNSIGNED NULL,
  estado             ENUM('vigente','reemplazada','anulada') NOT NULL DEFAULT 'vigente',
  observacion        VARCHAR(500) NULL,
  creado_por         BIGINT UNSIGNED NULL,
  creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_persona_tipo (tenant_id, persona_id, tipo, estado),
  CONSTRAINT fk_comp_empresa FOREIGN KEY (tenant_id, empresa_id)      REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_comp_persona FOREIGN KEY (tenant_id, persona_id)      REFERENCES persona (tenant_id, id),
  CONSTRAINT fk_comp_tipo    FOREIGN KEY (tipo)                       REFERENCES competencia_tipo (codigo),
  CONSTRAINT fk_comp_cap     FOREIGN KEY (tenant_id, capacitacion_id) REFERENCES capacitacion (tenant_id, id),
  CONSTRAINT fk_comp_doc     FOREIGN KEY (tenant_id, documento_id)    REFERENCES documento_sst (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

CREATE TRIGGER trg_competencia_bu BEFORE UPDATE ON competencia FOR EACH ROW
BEGIN
  IF OLD.estado <> 'vigente' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'competencia cerrada: no admite cambios';
  END IF;
  IF NOT (OLD.persona_id <=> NEW.persona_id AND OLD.tipo <=> NEW.tipo AND OLD.fecha_obtencion <=> NEW.fecha_obtencion
      AND OLD.fecha_vence <=> NEW.fecha_vence AND OLD.documento_id <=> NEW.documento_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'competencia: registre una nueva en lugar de modificarla';
  END IF;
END$$

CREATE TRIGGER trg_competencia_bd BEFORE DELETE ON competencia FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'competencia no se borra: anule';
END$$

CREATE TRIGGER trg_capacitacion_bu BEFORE UPDATE ON capacitacion FOR EACH ROW
BEGIN
  IF OLD.estado = 'anulada' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'capacitacion anulada';
  END IF;
  IF OLD.estado = 'realizada' AND NOT (OLD.tema <=> NEW.tema AND OLD.fecha <=> NEW.fecha AND OLD.horas <=> NEW.horas
      AND OLD.competencia <=> NEW.competencia AND NEW.estado = 'realizada') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'capacitacion realizada: solo admite eficacia y registro de asistencia';
  END IF;
END$$

CREATE TRIGGER trg_capacitacion_bd BEFORE DELETE ON capacitacion FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'capacitacion no se borra: anule';
END$$

CREATE TRIGGER trg_capacitacion_asistente_bi BEFORE INSERT ON capacitacion_asistente FOR EACH ROW
BEGIN
  IF (SELECT estado FROM capacitacion WHERE id = NEW.capacitacion_id) <> 'programada' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'la asistencia se registra al marcar la capacitacion como realizada';
  END IF;
END$$

CREATE TRIGGER trg_capacitacion_asistente_bu BEFORE UPDATE ON capacitacion_asistente FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'capacitacion_asistente es inmutable';
END$$

CREATE TRIGGER trg_capacitacion_asistente_bd BEFORE DELETE ON capacitacion_asistente FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'capacitacion_asistente es inmutable';
END$$

CREATE TRIGGER trg_cargo_competencia_bd BEFORE DELETE ON cargo_competencia FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'cargo_competencia no se borra: retire';
END$$

DELIMITER ;
