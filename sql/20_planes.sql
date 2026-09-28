-- Planes comerciales (decision del negocio, no norma). Requiere 01 a 19.
-- tenant.plan guarda el codigo; se valida en la aplicacion (el catalogo se carga despues de los scripts).

CREATE TABLE plan_comercial (
  codigo            VARCHAR(30)  NOT NULL PRIMARY KEY,
  nombre            VARCHAR(100) NOT NULL,
  descripcion       VARCHAR(500) NULL,
  conjuntos         JSON NOT NULL,
  max_empresas      INT UNSIGNED NULL,
  max_usuarios      INT UNSIGNED NULL,
  orden             TINYINT UNSIGNED NOT NULL DEFAULT 0,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
