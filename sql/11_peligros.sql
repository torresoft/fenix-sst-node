-- M05: identificacion de peligros, valoracion de riesgos y jerarquia de controles. Requiere 01 a 10.

CREATE TABLE metodologia_riesgo (
  codigo            VARCHAR(20)  NOT NULL PRIMARY KEY,
  nombre            VARCHAR(100) NOT NULL,
  escalas           JSON NOT NULL,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE peligro_clase (
  codigo            VARCHAR(20)  NOT NULL PRIMARY KEY,
  nombre            VARCHAR(100) NOT NULL,
  ejemplos          VARCHAR(500) NULL,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE control_jerarquia (
  codigo            VARCHAR(20)  NOT NULL PRIMARY KEY,
  nivel             TINYINT UNSIGNED NOT NULL,
  nombre            VARCHAR(100) NOT NULL,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_nivel (nivel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Version de la matriz. Anual, ante AT mortal o por gestion del cambio. La vigente se reemplaza al publicar otra.
CREATE TABLE matriz_riesgo (
  id                   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id            BIGINT UNSIGNED NOT NULL,
  empresa_id           BIGINT UNSIGNED NOT NULL,
  version              INT UNSIGNED NOT NULL,
  metodologia_codigo   VARCHAR(20) NOT NULL,
  motivo               ENUM('inicial','anual','at_mortal','cambio') NOT NULL,
  fecha_elaboracion    DATE NOT NULL,
  participantes        VARCHAR(1000) NULL,
  matriz_padre_id      BIGINT UNSIGNED NULL,
  documento_id         BIGINT UNSIGNED NULL,
  publicada_en         DATE NULL,
  observacion          VARCHAR(500) NULL,
  estado               ENUM('borrador','vigente','reemplazada','anulada') NOT NULL DEFAULT 'borrador',
  creado_por           BIGINT UNSIGNED NULL,
  creado_en            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en       DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_version (tenant_id, empresa_id, version),
  CONSTRAINT fk_mr_empresa FOREIGN KEY (tenant_id, empresa_id)      REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_mr_metod   FOREIGN KEY (metodologia_codigo)         REFERENCES metodologia_riesgo (codigo),
  CONSTRAINT fk_mr_padre   FOREIGN KEY (tenant_id, matriz_padre_id) REFERENCES matriz_riesgo (tenant_id, id),
  CONSTRAINT fk_mr_doc     FOREIGN KEY (tenant_id, documento_id)    REFERENCES documento_sst (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE riesgo_item (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id           BIGINT UNSIGNED NOT NULL,
  matriz_id           BIGINT UNSIGNED NOT NULL,
  proceso             VARCHAR(150) NOT NULL,
  centro_trabajo_id   BIGINT UNSIGNED NULL,
  actividad           VARCHAR(255) NOT NULL,
  tarea               VARCHAR(255) NULL,
  rutinaria           TINYINT(1) NOT NULL DEFAULT 1,
  clase_peligro       VARCHAR(20) NOT NULL,
  peligro             VARCHAR(255) NOT NULL,
  efectos             VARCHAR(500) NULL,
  control_fuente      VARCHAR(500) NULL,
  control_medio       VARCHAR(500) NULL,
  control_individuo   VARCHAR(500) NULL,
  nd                  VARCHAR(5) NOT NULL,
  ne                  VARCHAR(5) NOT NULL,
  nc                  VARCHAR(5) NOT NULL,
  np                  INT UNSIGNED NOT NULL,
  nr                  INT UNSIGNED NOT NULL,
  nivel_riesgo        VARCHAR(5) NOT NULL,
  aceptabilidad       VARCHAR(100) NOT NULL,
  expuestos           INT UNSIGNED NOT NULL DEFAULT 0,
  peor_consecuencia   VARCHAR(255) NULL,
  norma_codigo        VARCHAR(40) NULL,
  estado              ENUM('activo','retirado') NOT NULL DEFAULT 'activo',
  creado_por          BIGINT UNSIGNED NULL,
  creado_en           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en      DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_matriz (tenant_id, matriz_id, estado),
  CONSTRAINT fk_ri_matriz FOREIGN KEY (tenant_id, matriz_id)         REFERENCES matriz_riesgo (tenant_id, id),
  CONSTRAINT fk_ri_centro FOREIGN KEY (tenant_id, centro_trabajo_id) REFERENCES centro_trabajo (tenant_id, id),
  CONSTRAINT fk_ri_clase  FOREIGN KEY (clase_peligro)                REFERENCES peligro_clase (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cargos expuestos al peligro: alimenta las necesidades de formacion (M07) y el perfil del cargo.
CREATE TABLE riesgo_item_cargo (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  item_id     BIGINT UNSIGNED NOT NULL,
  cargo_id    BIGINT UNSIGNED NOT NULL,
  estado      ENUM('activo','retirado') NOT NULL DEFAULT 'activo',
  creado_por  BIGINT UNSIGNED NULL,
  creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_item_cargo (tenant_id, item_id, cargo_id),
  CONSTRAINT fk_ric_item  FOREIGN KEY (tenant_id, item_id)  REFERENCES riesgo_item (tenant_id, id),
  CONSTRAINT fk_ric_cargo FOREIGN KEY (tenant_id, cargo_id) REFERENCES cargo (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Medidas de intervencion con la jerarquia obligatoria (art. 2.2.4.6.24).
CREATE TABLE riesgo_control (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id             BIGINT UNSIGNED NOT NULL,
  item_id               BIGINT UNSIGNED NOT NULL,
  jerarquia_codigo      VARCHAR(20) NOT NULL,
  descripcion           VARCHAR(1000) NOT NULL,
  responsable           VARCHAR(150) NULL,
  fecha_limite          DATE NULL,
  fecha_implementacion  DATE NULL,
  observacion           VARCHAR(1000) NULL,
  estado                ENUM('propuesto','implementado','descartado') NOT NULL DEFAULT 'propuesto',
  creado_por            BIGINT UNSIGNED NULL,
  creado_en             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en        DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_item (tenant_id, item_id),
  CONSTRAINT fk_rc_item FOREIGN KEY (tenant_id, item_id) REFERENCES riesgo_item (tenant_id, id),
  CONSTRAINT fk_rc_jer  FOREIGN KEY (jerarquia_codigo)   REFERENCES control_jerarquia (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

CREATE TRIGGER trg_matriz_riesgo_bu BEFORE UPDATE ON matriz_riesgo FOR EACH ROW
BEGIN
  IF OLD.estado IN ('reemplazada','anulada') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'matriz cerrada: no admite cambios';
  END IF;
  IF OLD.estado = 'vigente' AND NOT (NEW.estado IN ('vigente','reemplazada') AND OLD.documento_id <=> NEW.documento_id
      AND OLD.participantes <=> NEW.participantes AND OLD.fecha_elaboracion <=> NEW.fecha_elaboracion) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'matriz vigente: cree una version nueva';
  END IF;
END$$

CREATE TRIGGER trg_matriz_riesgo_bd BEFORE DELETE ON matriz_riesgo FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'matriz_riesgo no se borra';
END$$

-- La valoracion solo se edita en borrador.
CREATE TRIGGER trg_riesgo_item_bi BEFORE INSERT ON riesgo_item FOR EACH ROW
BEGIN
  IF (SELECT estado FROM matriz_riesgo WHERE id = NEW.matriz_id) <> 'borrador' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'matriz publicada: cree una version nueva';
  END IF;
END$$

CREATE TRIGGER trg_riesgo_item_bu BEFORE UPDATE ON riesgo_item FOR EACH ROW
BEGIN
  IF (SELECT estado FROM matriz_riesgo WHERE id = OLD.matriz_id) <> 'borrador' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'matriz publicada: cree una version nueva';
  END IF;
END$$

CREATE TRIGGER trg_riesgo_item_bd BEFORE DELETE ON riesgo_item FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'riesgo_item no se borra: retire';
END$$

CREATE TRIGGER trg_riesgo_item_cargo_bu BEFORE UPDATE ON riesgo_item_cargo FOR EACH ROW
BEGIN
  IF (SELECT m.estado FROM riesgo_item i JOIN matriz_riesgo m ON m.id = i.matriz_id WHERE i.id = OLD.item_id) <> 'borrador' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'matriz publicada: cree una version nueva';
  END IF;
END$$

CREATE TRIGGER trg_riesgo_item_cargo_bd BEFORE DELETE ON riesgo_item_cargo FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'riesgo_item_cargo no se borra: retire';
END$$

CREATE TRIGGER trg_riesgo_control_bu BEFORE UPDATE ON riesgo_control FOR EACH ROW
BEGIN
  IF OLD.estado <> 'propuesto' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'control cerrado: no admite cambios';
  END IF;
END$$

CREATE TRIGGER trg_riesgo_control_bd BEFORE DELETE ON riesgo_control FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'riesgo_control no se borra: descarte';
END$$

DELIMITER ;
