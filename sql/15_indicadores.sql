-- M12: indicadores (resultado, estructura, proceso) con ficha tecnica. Requiere 01 a 14.

-- Ficha tecnica obligatoria por indicador (art. 2.2.4.6.19).
CREATE TABLE indicador_ficha (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id         BIGINT UNSIGNED NOT NULL,
  empresa_id        BIGINT UNSIGNED NOT NULL,
  indicador_codigo  VARCHAR(40) NOT NULL,
  meta              DECIMAL(14,4) NULL,
  sentido           ENUM('mayor','menor') NOT NULL DEFAULT 'mayor',
  responsable       VARCHAR(150) NULL,
  fuente            VARCHAR(255) NULL,
  observacion       VARCHAR(500) NULL,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  creado_por        BIGINT UNSIGNED NULL,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_empresa_ind (tenant_id, empresa_id, indicador_codigo),
  CONSTRAINT fk_if_empresa FOREIGN KEY (tenant_id, empresa_id) REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_if_ind     FOREIGN KEY (indicador_codigo)      REFERENCES indicador_catalogo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Medicion por periodo ('YYYY-MM' mensual, 'YYYY' anual). Un recalculo distinto reemplaza, no sobrescribe.
CREATE TABLE indicador_medicion (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id         BIGINT UNSIGNED NOT NULL,
  empresa_id        BIGINT UNSIGNED NOT NULL,
  indicador_codigo  VARCHAR(40) NOT NULL,
  periodo           VARCHAR(7) NOT NULL,
  numerador         DECIMAL(14,4) NULL,
  denominador       DECIMAL(14,4) NULL,
  valor             DECIMAL(14,4) NULL,
  metodo            VARCHAR(500) NULL,
  origen            ENUM('calculado','manual') NOT NULL,
  observacion       VARCHAR(500) NULL,
  estado            ENUM('vigente','reemplazada') NOT NULL DEFAULT 'vigente',
  creado_por        BIGINT UNSIGNED NULL,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_ind_periodo (tenant_id, empresa_id, indicador_codigo, periodo, estado),
  CONSTRAINT fk_im_empresa FOREIGN KEY (tenant_id, empresa_id) REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_im_ind     FOREIGN KEY (indicador_codigo)      REFERENCES indicador_catalogo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

CREATE TRIGGER trg_indicador_medicion_bu BEFORE UPDATE ON indicador_medicion FOR EACH ROW
BEGIN
  IF OLD.estado <> 'vigente' OR NOT (OLD.numerador <=> NEW.numerador AND OLD.denominador <=> NEW.denominador
      AND OLD.valor <=> NEW.valor AND OLD.periodo <=> NEW.periodo) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'medicion: registre una nueva en lugar de modificarla';
  END IF;
END$$

CREATE TRIGGER trg_indicador_medicion_bd BEFORE DELETE ON indicador_medicion FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'indicador_medicion no se borra';
END$$

CREATE TRIGGER trg_indicador_ficha_bd BEFORE DELETE ON indicador_ficha FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'indicador_ficha no se borra: inactive';
END$$

DELIMITER ;
