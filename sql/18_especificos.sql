-- F6: M18 PESV y quimicos + bitacora de importaciones (nomina, PILA). Requiere 01 a 17.

CREATE TABLE pesv_paso (
  codigo             VARCHAR(10)  NOT NULL PRIMARY KEY,
  fase               ENUM('planificacion','implementacion','seguimiento','mejora') NOT NULL,
  nombre             VARCHAR(200) NOT NULL,
  estado             ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual  TINYINT(1) NOT NULL DEFAULT 0,
  creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por    BIGINT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Avance por paso: cada cambio es una fila nueva; el estado vigente es la ultima.
CREATE TABLE pesv_avance (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  empresa_id      BIGINT UNSIGNED NOT NULL,
  paso_codigo     VARCHAR(10) NOT NULL,
  estado          ENUM('no_iniciado','en_proceso','implementado','no_aplica') NOT NULL,
  fecha           DATE NOT NULL,
  documento_id    BIGINT UNSIGNED NULL,
  observacion     VARCHAR(1000) NULL,
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_paso (tenant_id, empresa_id, paso_codigo, id),
  CONSTRAINT fk_pav_empresa FOREIGN KEY (tenant_id, empresa_id)   REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_pav_paso    FOREIGN KEY (paso_codigo)             REFERENCES pesv_paso (codigo),
  CONSTRAINT fk_pav_doc     FOREIGN KEY (tenant_id, documento_id) REFERENCES documento_sst (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE vehiculo (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id          BIGINT UNSIGNED NOT NULL,
  empresa_id         BIGINT UNSIGNED NOT NULL,
  placa              VARCHAR(10)  NOT NULL,
  tipo               ENUM('automovil','camioneta','camion','bus','motocicleta','maquinaria','otro') NOT NULL,
  propiedad          ENUM('propio','leasing','tercero','colaborador') NOT NULL,
  marca_modelo       VARCHAR(100) NULL,
  soat_vence         DATE NOT NULL,
  rtm_vence          DATE NULL,
  motivo_estado      VARCHAR(500) NULL,
  estado             ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  creado_por         BIGINT UNSIGNED NULL,
  creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_placa (tenant_id, empresa_id, placa),
  CONSTRAINT fk_veh_empresa FOREIGN KEY (tenant_id, empresa_id) REFERENCES empresa (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE conductor (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id           BIGINT UNSIGNED NOT NULL,
  empresa_id          BIGINT UNSIGNED NOT NULL,
  persona_id          BIGINT UNSIGNED NOT NULL,
  licencia_numero     VARCHAR(30) NOT NULL,
  licencia_categoria  VARCHAR(10) NOT NULL,
  licencia_vence      DATE NOT NULL,
  estado              ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  creado_por          BIGINT UNSIGNED NULL,
  creado_en           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en      DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_persona (tenant_id, empresa_id, persona_id, estado),
  CONSTRAINT fk_cond_empresa FOREIGN KEY (tenant_id, empresa_id) REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_cond_persona FOREIGN KEY (tenant_id, persona_id) REFERENCES persona (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE preoperacional (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id      BIGINT UNSIGNED NOT NULL,
  vehiculo_id    BIGINT UNSIGNED NOT NULL,
  conductor_id   BIGINT UNSIGNED NOT NULL,
  fecha          DATE NOT NULL,
  items          JSON NOT NULL,
  apto           TINYINT(1) NOT NULL,
  observacion    VARCHAR(1000) NULL,
  creado_por     BIGINT UNSIGNED NULL,
  creado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_vehiculo (tenant_id, vehiculo_id, fecha),
  CONSTRAINT fk_pre_vehiculo  FOREIGN KEY (tenant_id, vehiculo_id)  REFERENCES vehiculo (tenant_id, id),
  CONSTRAINT fk_pre_conductor FOREIGN KEY (tenant_id, conductor_id) REFERENCES conductor (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE producto_quimico (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id          BIGINT UNSIGNED NOT NULL,
  empresa_id         BIGINT UNSIGNED NOT NULL,
  centro_trabajo_id  BIGINT UNSIGNED NULL,
  nombre             VARCHAR(150) NOT NULL,
  fabricante         VARCHAR(150) NULL,
  uso                VARCHAR(300) NOT NULL,
  ubicacion          VARCHAR(150) NOT NULL,
  cantidad           VARCHAR(60)  NULL,
  pictogramas        JSON NOT NULL,
  fds_documento_id   BIGINT UNSIGNED NULL,
  fds_fecha          DATE NULL,
  etiquetado_sga     TINYINT(1) NOT NULL DEFAULT 0,
  motivo_estado      VARCHAR(500) NULL,
  estado             ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  creado_por         BIGINT UNSIGNED NULL,
  creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_empresa (tenant_id, empresa_id, estado),
  CONSTRAINT fk_pq_empresa FOREIGN KEY (tenant_id, empresa_id)        REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_pq_centro  FOREIGN KEY (tenant_id, centro_trabajo_id) REFERENCES centro_trabajo (tenant_id, id),
  CONSTRAINT fk_pq_fds     FOREIGN KEY (tenant_id, fds_documento_id)  REFERENCES documento_sst (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bitacora de importaciones: archivo, huella y resultado por fila.
CREATE TABLE importacion (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  empresa_id      BIGINT UNSIGNED NOT NULL,
  tipo            ENUM('nomina','pila') NOT NULL,
  archivo_nombre  VARCHAR(255) NOT NULL,
  archivo_hash    CHAR(64) NOT NULL,
  filas           INT UNSIGNED NOT NULL,
  aplicadas       INT UNSIGNED NOT NULL,
  resultado       JSON NOT NULL,
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_empresa (tenant_id, empresa_id, creado_en),
  CONSTRAINT fk_imp_empresa FOREIGN KEY (tenant_id, empresa_id) REFERENCES empresa (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

CREATE TRIGGER trg_pesv_avance_bu BEFORE UPDATE ON pesv_avance FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pesv_avance es inmutable: registre el nuevo estado';
END$$

CREATE TRIGGER trg_pesv_avance_bd BEFORE DELETE ON pesv_avance FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pesv_avance es inmutable';
END$$

CREATE TRIGGER trg_vehiculo_bu BEFORE UPDATE ON vehiculo FOR EACH ROW
BEGIN
  IF OLD.estado = 'inactivo' OR NOT (OLD.placa <=> NEW.placa) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'vehiculo inactivo o placa inmutable';
  END IF;
END$$

CREATE TRIGGER trg_vehiculo_bd BEFORE DELETE ON vehiculo FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'vehiculo no se borra: inactive';
END$$

CREATE TRIGGER trg_conductor_bu BEFORE UPDATE ON conductor FOR EACH ROW
BEGIN
  IF OLD.estado = 'inactivo' OR NOT (OLD.persona_id <=> NEW.persona_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'conductor inactivo: registre de nuevo';
  END IF;
END$$

CREATE TRIGGER trg_conductor_bd BEFORE DELETE ON conductor FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'conductor no se borra: inactive';
END$$

CREATE TRIGGER trg_preoperacional_bu BEFORE UPDATE ON preoperacional FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'preoperacional es inmutable';
END$$

CREATE TRIGGER trg_preoperacional_bd BEFORE DELETE ON preoperacional FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'preoperacional es inmutable';
END$$

CREATE TRIGGER trg_producto_quimico_bu BEFORE UPDATE ON producto_quimico FOR EACH ROW
BEGIN
  IF OLD.estado = 'inactivo' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'producto inactivo: registre de nuevo';
  END IF;
END$$

CREATE TRIGGER trg_producto_quimico_bd BEFORE DELETE ON producto_quimico FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'producto_quimico no se borra: inactive';
END$$

CREATE TRIGGER trg_importacion_bu BEFORE UPDATE ON importacion FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'importacion es inmutable';
END$$

CREATE TRIGGER trg_importacion_bd BEFORE DELETE ON importacion FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'importacion es inmutable';
END$$

DELIMITER ;
