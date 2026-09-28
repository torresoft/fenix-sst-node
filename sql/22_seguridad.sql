-- Endurecimiento de seguridad. Requiere 01 a 21.

-- Roles por empresa: empresa_id NULL = el rol vale en todas las empresas del tenant.
-- 'convivencia' siempre va amarrado a una empresa: cada empleador tiene su comite y la reserva de sus quejas.
ALTER TABLE usuario_tenant ADD COLUMN empresa_id BIGINT UNSIGNED NULL AFTER usuario_id;
ALTER TABLE usuario_tenant ADD UNIQUE KEY uq_tenant_usuario_rol_empresa (tenant_id, usuario_id, rol_codigo, empresa_id);
ALTER TABLE usuario_tenant DROP INDEX uq_tenant_usuario_rol;
ALTER TABLE usuario_tenant ADD CONSTRAINT fk_ut_empresa FOREIGN KEY (tenant_id, empresa_id) REFERENCES empresa (tenant_id, id);

-- Asignaciones previas de convivencia: quedan en la primera empresa del tenant (el admin reasigna si tiene varias).
UPDATE usuario_tenant ut
   SET ut.empresa_id = (SELECT MIN(e.id) FROM empresa e WHERE e.tenant_id = ut.tenant_id)
 WHERE ut.rol_codigo = 'convivencia' AND ut.empresa_id IS NULL;

-- La solicitud de firma solo puede apuntar a una firma del mismo tenant.
ALTER TABLE firma ADD UNIQUE KEY uq_tenant_id (tenant_id, id);
ALTER TABLE firma_solicitud DROP FOREIGN KEY fk_fs_firma;
ALTER TABLE firma_solicitud ADD CONSTRAINT fk_fs_firma_tenant FOREIGN KEY (tenant_id, firma_id) REFERENCES firma (tenant_id, id);
