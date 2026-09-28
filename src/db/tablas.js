// Registro de tablas. Toda tabla nueva se registra aqui o la capa de datos la rechaza.

// Llevan tenant_id y solo se tocan via RepositorioTenant.
const TENANT = new Set([
  'empresa', 'empresa_ambito', 'centro_trabajo', 'cargo', 'persona', 'vinculacion',
  'documento_sst', 'firma', 'consentimiento', 'usuario_tenant', 'auditoria_log',
  'obligacion_pendiente', 'notificacion_envio',
  'matriz_legal_item', 'matriz_legal_evidencia', 'documento_norma', 'boletin_empresa', 'auditoria_matriz',
  'empresa_clasificacion', 'evidencia_estandar', 'autoevaluacion', 'autoevaluacion_item', 'accion_mejora',
  'retencion_empresa', 'acuerdo_firma', 'firma_solicitud', 'firma_otp',
  'evento', 'evento_reporte', 'evento_investigador', 'evento_causa',
  'comite', 'comite_miembro', 'comite_sesion', 'comite_asistencia', 'comite_compromiso',
  'matriz_riesgo', 'riesgo_item', 'riesgo_item_cargo', 'riesgo_control',
  'cargo_competencia', 'capacitacion', 'capacitacion_asistente', 'competencia',
  'plan_anual', 'plan_objetivo', 'plan_actividad', 'gestion_cambio',
  'evaluacion_medica', 'incapacidad', 'indicador_medicion', 'indicador_ficha',
  'queja_convivencia', 'queja_actuacion', 'evaluacion_psicosocial', 'evaluacion_psicosocial_grupo',
  'brigada_miembro', 'equipo_emergencia', 'equipo_revision', 'simulacro', 'inspeccion', 'inspeccion_hallazgo',
  'epp_elemento', 'cargo_epp', 'epp_ingreso', 'epp_entrega', 'permiso_trabajo', 'permiso_ejecutor',
  'contratista', 'contratista_evaluacion', 'contratista_trabajador', 'sgrl_verificacion',
  'pesv_avance', 'vehiculo', 'conductor', 'preoperacional', 'producto_quimico', 'importacion',
]);

// Catalogos globales (lectura para todos; escritura solo superadmin / seed).
const GLOBAL = new Set([
  'clase_riesgo', 'norma', 'estandar_conjunto', 'estandar_ponderacion', 'estandar_valoracion',
  'estandar_minimo', 'estandar_requisito', 'estandar_requisito_numeral', 'plazo_legal', 'vencimiento_recurrente', 'indicador_catalogo',
  'tipo_documental', 'festivo', 'rol', 'norma_desinformacion', 'ambito_normativo', 'boletin_normativo',
  'estandar_cargue', 'evento_criterio_grave', 'investigacion_rol', 'comite_tipo',
  'metodologia_riesgo', 'peligro_clase', 'control_jerarquia', 'peligro_tipo', 'cargo_tipo', 'plan_comercial', 'competencia_tipo', 'finalidad_datos', 'equipo_tipo', 'permiso_tipo', 'pesv_paso',
]);

// Nunca se actualizan desde la app (append-only).
const INMUTABLES = new Set(['firma', 'auditoria_log', 'notificacion_envio', 'auditoria_matriz', 'acuerdo_firma', 'evento_reporte', 'comite_asistencia', 'capacitacion_asistente', 'queja_actuacion', 'evaluacion_psicosocial_grupo',
  'equipo_revision', 'epp_ingreso', 'permiso_ejecutor', 'contratista_evaluacion', 'sgrl_verificacion',
  'pesv_avance', 'preoperacional', 'importacion']);

// Tablas sin columna creado_por.
const SIN_CREADO_POR = new Set(['firma', 'auditoria_log', 'notificacion_envio', 'acuerdo_firma']);

module.exports = { TENANT, GLOBAL, INMUTABLES, SIN_CREADO_POR };
