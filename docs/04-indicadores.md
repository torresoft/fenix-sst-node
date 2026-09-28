# 04 · Indicadores

El art. 2.2.4.6.19 exige que **cada** indicador tenga ficha tecnica:
definicion, interpretacion, limite o valor de cumplimiento, metodo de calculo,
fuente de la informacion, periodicidad del reporte y personas que deben conocer
el resultado. La ficha es una entidad del modelo, no un PDF suelto.

Datos estructurados en `data/indicadores.json`.

## Indicadores minimos de resultado (Res. 0312 art. 30)

| Indicador | Formula | Periodicidad |
|---|---|---|
| Frecuencia de accidentalidad | (N.º AT en el mes / N.º trabajadores en el mes) × 100 | Mensual |
| Severidad de accidentalidad | (dias de incapacidad por AT + dias cargados) / N.º trabajadores × 100 | Mensual |
| Proporcion de AT mortales | (N.º AT mortales en el anio / total AT en el anio) × 100 | Anual |
| Prevalencia de enfermedad laboral | (casos nuevos + antiguos de EL / promedio de trabajadores) × 100.000 | Anual |
| Incidencia de enfermedad laboral | (casos nuevos de EL / promedio de trabajadores) × 100.000 | Anual |
| Ausentismo por causa medica | (dias de ausencia por incapacidad / dias de trabajo programados) × 100 | Mensual |

> **No verificado al 100%**: la redaccion literal del art. 30 no se leyo en
> fuente oficial. La interpretacion de "dias cargados" y de "promedio de
> trabajadores" cambia el resultado y es motivo frecuente de discusion en
> auditoria. Contrastar contra el PDF oficial antes de fijar denominadores en
> produccion, y dejar la formula en el catalogo para poder corregirla sin tocar
> codigo.

## Indicadores de estructura (art. 2.2.4.6.20) — 8 minimos

Todos son booleanos **derivables del estado del expediente**: el sistema los
calcula sin intervencion humana.

1. Politica divulgada
2. Objetivos y metas definidos
3. Plan de trabajo anual con cronograma
4. Responsabilidades asignadas
5. Metodo de identificacion de peligros definido
6. COPASST o Vigia conformado
7. Plan de prevencion y respuesta ante emergencias
8. Programa de capacitacion definido

## Indicadores de proceso (art. 2.2.4.6.21) — 12 minimos

Todos son porcentajes `ejecutado / programado`, derivados del cronograma.
No se digitan.

1. Ejecucion de la evaluacion inicial
2. Ejecucion del plan de trabajo anual y su cronograma
3. Ejecucion del plan de capacitacion
4. Intervencion de peligros identificados
5. Evaluacion de condiciones de salud y de trabajo
6. Ejecucion de acciones preventivas y correctivas de investigaciones
7. Ejecucion del cronograma de mediciones ambientales
8. Desarrollo de los programas de vigilancia epidemiologica
9. Cumplimiento de procesos de reporte e investigacion
10. Registro estadistico de EL, AT, incidentes y ausentismo
11. Ejecucion del plan de emergencias
12. Ejecucion del plan de mantenimiento de equipos

## Modelo

```
indicador
  id, tenant_id, codigo, nombre, tipo (estructura|proceso|resultado)
  norma_codigo, definicion, interpretacion, limite, meta
  formula_texto, formula_expr, fuente_informacion
  periodicidad (mensual|trimestral|semestral|anual)
  destinatarios

medicion_indicador
  id, indicador_id, periodo_inicio, periodo_fin
  numerador, denominador, valor, cumple
  calculado_en, calculado_por (sistema|usuario)
```

Guardar **numerador y denominador**, no solo el valor: cuando la interpretacion
de la formula cambie, se puede recalcular la serie historica sin perder datos.
