-- Catalogos de sugerencia para la matriz de peligros y el perfil de riesgo del cargo. Requiere 01 a 18.

-- Peligros tipo (Anexo A GTC 45) con efectos, NC y medidas sugeridas por nivel de la jerarquia.
CREATE TABLE peligro_tipo (
  codigo            VARCHAR(30)  NOT NULL PRIMARY KEY,
  clase_codigo      VARCHAR(20)  NOT NULL,
  nombre            VARCHAR(255) NOT NULL,
  efectos           VARCHAR(500) NULL,
  peor_consecuencia VARCHAR(255) NULL,
  nc_sugerido       VARCHAR(5)   NULL,
  norma_codigo      VARCHAR(40)  NULL,
  controles         JSON NOT NULL,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL,
  CONSTRAINT fk_ptipo_clase FOREIGN KEY (clase_codigo) REFERENCES peligro_clase (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cargos tipo: peligros con exposicion tipica [{peligro, ne}] y competencias exigibles.
CREATE TABLE cargo_tipo (
  codigo            VARCHAR(30)  NOT NULL PRIMARY KEY,
  nombre            VARCHAR(150) NOT NULL,
  descripcion       VARCHAR(1000) NULL,
  peligros          JSON NOT NULL,
  competencias      JSON NOT NULL,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE cargo
  ADD COLUMN cargo_tipo_codigo VARCHAR(30) NULL AFTER nombre,
  ADD CONSTRAINT fk_cargo_tipo FOREIGN KEY (cargo_tipo_codigo) REFERENCES cargo_tipo (codigo);

-- sugerido = 1: generado desde el perfil del cargo; debe revisarse antes de publicar la matriz.
ALTER TABLE riesgo_item
  ADD COLUMN peligro_tipo_codigo VARCHAR(30) NULL AFTER clase_peligro,
  ADD COLUMN sugerido TINYINT(1) NOT NULL DEFAULT 0 AFTER norma_codigo,
  ADD CONSTRAINT fk_ri_ptipo FOREIGN KEY (peligro_tipo_codigo) REFERENCES peligro_tipo (codigo);
