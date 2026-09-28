# 05 · Motor de plazos y vencimientos

La mayoria de las sanciones no ocurren por no hacer las cosas, sino por hacerlas
tarde. Es el diferenciador funcional mas defendible del producto y el mas
dificil de copiar bien, porque mezcla dias habiles, dias calendario y
disparadores por evento.

Datos estructurados en `data/plazos_legales.json`.

## Plazos disparados por evento

| Disparador | Plazo | Tipo | Norma |
|---|---|---|---|
| Ocurrencia de AT o diagnostico de EL → reporte a ARL, EPS y Direccion Territorial | 2 dias | **Habiles** | Res. 2851/2015 |
| Ocurrencia de AT o incidente → investigacion completa | 15 dias | Calendario | Res. 1401/2007 |
| Accidente grave o mortal → remision del informe a la ARL | 15 dias | Calendario | Res. 1401/2007 |
| Accidente grave o riesgo inminente → reunion extraordinaria del COPASST | 5 dias | Calendario | Res. 2013/1986 |
| Concepto medico con restricciones → adaptacion de condiciones de trabajo | 20 dias | **Habiles** | Res. 1843/2025 |
| Terminacion del contrato → examen medico de egreso | 5 dias | Calendario | Res. 1843/2025 |
| Solicitud de la victima → medidas de proteccion por acoso o violencia | 5 dias | **Habiles** | D. 1040/2026 |
| Radicacion de queja → cierre del procedimiento de convivencia | 65 dias | Calendario | Res. 3461/2025 |
| Calificacion critica (<60%) → envio del plan de mejoramiento a la ARL | 3 meses | Calendario | Res. 0312/2019 |
| Incidente de seguridad de datos → reporte a la SIC | 15 dias | **Habiles** | Circular Unica SIC |
| Consulta de titular de datos → respuesta | 10 dias | **Habiles** | Ley 1581/2012 |
| Reclamo de titular de datos → respuesta | 15 dias | **Habiles** | Ley 1581/2012 |

## Vencimientos recurrentes a vigilar

| Elemento | Vigencia | Consecuencia del vencimiento |
|---|---|---|
| Periodo del COPASST y del Comite de Convivencia | 2 anios | Comite inexistente → estandar no cumplido |
| Licencia en SST del responsable | 10 anios | SG-SST sin responsable habilitado |
| Curso de actualizacion de 20 horas | 3 anios | Competencia del responsable no acreditada |
| Certificacion de trabajo en alturas | Reentrenamiento por evento, minimo 8 h | Trabajador no autorizado para la tarea |
| Reentrenamiento en espacios confinados | 3 anios | Personal no habilitado |
| Habilitacion para riesgo electrico | Maximo 1 anio | Personal no habilitado |
| Bateria de riesgo psicosocial | 1 anio (riesgo alto/muy alto) / 2 anios (medio/bajo) | Evaluacion vencida |
| Fichas de datos de seguridad SGA | Actualizacion cada 5 anios | Informacion quimica desactualizada |
| Examenes medicos periodicos | Segun SVE y perfil de cargo | Vigilancia epidemiologica incompleta |
| Actualizacion del RNBD ante la SIC | Entre el 2 de enero y el 31 de marzo | Sancion de la Superintendencia |
| Revision de la politica de SST | 1 anio | Estandar no cumplido |
| Simulacro de emergencias | 1 anio | Estandar no cumplido |
| Actualizacion de la matriz de peligros | 1 anio + ante AT mortal | Estandar no cumplido |
| Auditoria interna | 1 anio | Estandar no cumplido |
| Revision por la alta direccion | 1 anio | Estandar no cumplido |

> **No verificado**: la periodicidad calendario del reentrenamiento en alturas
> (Res. 4272/2021 art. 27). Las fuentes coinciden en 8 horas minimas y en
> disparadores por evento (cambio de empleador, proyecto, tecnica o
> tecnologia), no en un aniversario fijo. No programar una alerta anual
> automatica sin confirmar el articulo.

## Implementacion

### Calendario de festivos
`data/festivos_co.json` trae los festivos colombianos 2026–2031 calculados con
la Ley 51 de 1983 (Ley Emiliani): los festivos trasladables se corren al lunes
siguiente si no caen lunes. Cargarlo en la tabla `festivo` y ampliarlo cada
anio. Verificar contra el calendario oficial antes de produccion.

### Helper obligatorio

```js
// Suma n dias habiles a una fecha, saltando sabados, domingos y festivos.
// tipo: 'habil' | 'calendario'
function sumarPlazo(fechaBase, cantidad, tipo, festivos) { ... }

// Devuelve el estado de un plazo: 'en_termino' | 'por_vencer' | 'vencido'
function estadoPlazo(fechaLimite, hoy, diasAlerta = 3) { ... }
```

Nunca usar aritmetica simple de dias para un plazo habil.

### Modelo

```
plazo_legal            (catalogo global)
  codigo, descripcion, cantidad, tipo (habil|calendario|mes)
  norma_codigo, evento_disparador, entidad_destino

obligacion_pendiente   (instancia por tenant)
  id, tenant_id, plazo_codigo, entidad_origen_tipo, entidad_origen_id
  fecha_disparo, fecha_limite, fecha_cumplimiento
  estado (en_termino|por_vencer|vencido|cumplido)
  responsable_id, evidencia_documento_id
```

El motor de alertas recorre `obligacion_pendiente`, no cada modulo por separado.
