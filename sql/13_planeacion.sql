-- M06: plan de trabajo anual, objetivos, presupuesto y gestion del cambio. Requiere 01 a 12.

CREATE TABLE plan_anual (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id         BIGINT UNSIGNED NOT NULL,
  empresa_id        BIGINT UNSIGNED NOT NULL,
  vigencia_anio     SMALLINT UNSIGNED NOT NULL,
  presupuesto_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  documento_id      BIGINT UNSIGNED NULL,
  aprobado_en       DATE NULL,
  aprobado_por      BIGINT UNSIGNED NULL,
  estado            ENUM('borrador','aprobado','cerrado') NOT NULL DEFAULT 'borrador',
  creado_por        BIGINT UNSIGNED NULL,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_vigencia (tenant_id, empresa_id, vigencia_anio),
  CONSTRAINT fk_pa_empresa FOREIGN KEY (tenant_id, empresa_id)   REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_pa_doc     FOREIGN KEY (tenant_id, documento_id) REFERENCES documento_sst (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE plan_objetivo (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id          BIGINT UNSIGNED NOT NULL,
  plan_id            BIGINT UNSIGNED NOT NULL,
  descripcion        VARCHAR(500) NOT NULL,
  meta               VARCHAR(255) NOT NULL,
  indicador_codigo   VARCHAR(40) NULL,
  estado             ENUM('activo','retirado') NOT NULL DEFAULT 'activo',
  creado_por         BIGINT UNSIGNED NULL,
  creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  CONSTRAINT fk_po_plan FOREIGN KEY (tenant_id, plan_id)  REFERENCES plan_anual (tenant_id, id),
  CONSTRAINT fk_po_ind  FOREIGN KEY (indicador_codigo)    REFERENCES indicador_catalogo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Actividad del cronograma. origen capa: viene de una accion_mejora abierta (se cierran juntas).
CREATE TABLE plan_actividad (
  id                      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id               BIGINT UNSIGNED NOT NULL,
  plan_id                 BIGINT UNSIGNED NOT NULL,
  objetivo_id             BIGINT UNSIGNED NULL,
  descripcion             VARCHAR(500) NOT NULL,
  ciclo                   ENUM('PLANEAR','HACER','VERIFICAR','ACTUAR') NOT NULL,
  responsable_id          BIGINT UNSIGNED NULL,
  responsable_texto       VARCHAR(150) NULL,
  fecha_inicio            DATE NOT NULL,
  fecha_fin               DATE NOT NULL,
  recursos                VARCHAR(500) NULL,
  presupuesto             DECIMAL(14,2) NOT NULL DEFAULT 0,
  origen                  ENUM('manual','capa') NOT NULL DEFAULT 'manual',
  accion_mejora_id        BIGINT UNSIGNED NULL,
  fecha_ejecucion         DATE NULL,
  evidencia_documento_id  BIGINT UNSIGNED NULL,
  observacion             VARCHAR(1000) NULL,
  estado                  ENUM('programada','ejecutada','cancelada') NOT NULL DEFAULT 'programada',
  creado_por              BIGINT UNSIGNED NULL,
  creado_en               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en          DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_accion (tenant_id, plan_id, accion_mejora_id),
  KEY idx_plan_estado (tenant_id, plan_id, estado, fecha_fin),
  CONSTRAINT fk_pact_plan  FOREIGN KEY (tenant_id, plan_id)                REFERENCES plan_anual (tenant_id, id),
  CONSTRAINT fk_pact_obj   FOREIGN KEY (tenant_id, objetivo_id)            REFERENCES plan_objetivo (tenant_id, id),
  CONSTRAINT fk_pact_resp  FOREIGN KEY (responsable_id)                    REFERENCES usuario (id),
  CONSTRAINT fk_pact_capa  FOREIGN KEY (tenant_id, accion_mejora_id)       REFERENCES accion_mejora (tenant_id, id),
  CONSTRAINT fk_pact_doc   FOREIGN KEY (tenant_id, evidencia_documento_id) REFERENCES documento_sst (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gestion del cambio (art. 2.2.4.6.26): evaluar el impacto en SST antes de implementar.
CREATE TABLE gestion_cambio (
  id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id              BIGINT UNSIGNED NOT NULL,
  empresa_id             BIGINT UNSIGNED NOT NULL,
  tipo                   ENUM('proceso','instalacion','maquinaria','organizacional','legal','otro') NOT NULL,
  descripcion            VARCHAR(1000) NOT NULL,
  fecha_prevista         DATE NOT NULL,
  impacto_sst            VARCHAR(2000) NULL,
  actualiza_peligros     TINYINT(1) NOT NULL DEFAULT 0,
  requiere_capacitacion  TINYINT(1) NOT NULL DEFAULT 0,
  responsable_texto      VARCHAR(150) NULL,
  fecha_implementacion   DATE NULL,
  observacion            VARCHAR(1000) NULL,
  estado                 ENUM('en_evaluacion','aprobado','implementado','rechazado') NOT NULL DEFAULT 'en_evaluacion',
  creado_por             BIGINT UNSIGNED NULL,
  creado_en              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en         DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_empresa (tenant_id, empresa_id, estado),
  CONSTRAINT fk_gc_empresa FOREIGN KEY (tenant_id, empresa_id) REFERENCES empresa (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

CREATE TRIGGER trg_plan_anual_bu BEFORE UPDATE ON plan_anual FOR EACH ROW
BEGIN
  IF OLD.estado = 'cerrado' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'plan cerrado: no admite cambios';
  END IF;
  IF OLD.estado = 'aprobado' AND NOT (OLD.documento_id <=> NEW.documento_id AND OLD.aprobado_en <=> NEW.aprobado_en
      AND NEW.estado IN ('aprobado','cerrado')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'plan aprobado: el documento y la aprobacion son inmutables';
  END IF;
END$$

CREATE TRIGGER trg_plan_anual_bd BEFORE DELETE ON plan_anual FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'plan_anual no se borra';
END$$

CREATE TRIGGER trg_plan_actividad_bu BEFORE UPDATE ON plan_actividad FOR EACH ROW
BEGIN
  IF OLD.estado <> 'programada' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'actividad cerrada: no admite cambios';
  END IF;
END$$

CREATE TRIGGER trg_plan_actividad_bd BEFORE DELETE ON plan_actividad FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'plan_actividad no se borra: cancele';
END$$

CREATE TRIGGER trg_plan_objetivo_bd BEFORE DELETE ON plan_objetivo FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'plan_objetivo no se borra: retire';
END$$

CREATE TRIGGER trg_gestion_cambio_bu BEFORE UPDATE ON gestion_cambio FOR EACH ROW
BEGIN
  IF OLD.estado IN ('implementado','rechazado') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'cambio cerrado: no admite cambios';
  END IF;
END$$

CREATE TRIGGER trg_gestion_cambio_bd BEFORE DELETE ON gestion_cambio FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'gestion_cambio no se borra';
END$$

DELIMITER ;
