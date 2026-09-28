# 03 · Motor de estandares minimos (Resolucion 0312 de 2019)

Es la unica norma que convierte el cumplimiento en un numero. Ese numero es lo
que entiende el gerente, lo que revisa el inspector y el centro del tablero.
Datos estructurados en `data/estandares_minimos.json`.

## Aplicabilidad

Se deriva de dos datos de la empresa: **numero de trabajadores** y
**clase de riesgo** (I a V).

| Perfil | Articulo | Estandares | Perfil habilitado para disenar el SG-SST |
|---|---|---|---|
| Unidad agropecuaria <= 10 trab., riesgo I–III | Art. 7 | 3 | No lo define el art. 7 |
| <= 10 trabajadores, riesgo I, II o III | Art. 3 | 7 | Tecnico en SST con licencia, 1 anio de experiencia, curso 50 h |
| 11 a 50 trabajadores, riesgo I, II o III | Art. 9 | 21 | Tecnologo en SST con licencia, 2 anios de experiencia, curso 50 h |
| > 50 trabajadores, **o** cualquier tamanio con riesgo IV o V (arts. 8, 15, 16) | Art. 16 | 60 | Profesional o profesional con posgrado en SST, licencia, curso 50 h |

Un cambio en el numero de trabajadores o en la clase de riesgo **reclasifica el
SG-SST completo**: el sistema debe recalcular el conjunto aplicable y avisar.

## Ponderacion por ciclo PHVA (art. 27)

| Ciclo | Peso | Desglose |
|---|---|---|
| I. PLANEAR | 25% | Recursos 10% + Gestion integral del SG-SST 15% |
| II. HACER | 60% | Gestion de la salud 20% + Gestion de peligros y riesgos 30% + Gestion de amenazas 10% |
| III. VERIFICAR | 5% | Verificacion del SG-SST 5% |
| IV. ACTUAR | 10% | Mejoramiento 10% |

Total 100 puntos. Cada estandar individual pesa entre 0,5% y 5%.
Los 7 y los 21 no tienen pesos propios: mapean a numerales de la tabla de 60.
Art. 27: el item que no aplica (fuera del conjunto o justificado) **se califica
con el puntaje maximo**, por eso la escala siempre es sobre 100.

## Valoracion (art. 28)

| Resultado | Valoracion | Accion exigida |
|---|---|---|
| < 60% | **CRITICO** | Plan de mejoramiento de inmediato a disposicion del MinTrabajo; reporte de avances a la ARL en maximo 3 meses; seguimiento anual y plan de visita del MinTrabajo. |
| 60% – 85% | **MODERADAMENTE ACEPTABLE** | Plan de mejoramiento a disposicion del MinTrabajo; reporte de avances a la ARL en maximo 6 meses; plan de visita del MinTrabajo. |
| > 85% | **ACEPTABLE** | Mantener calificacion y evidencias a disposicion del MinTrabajo; incluir las mejoras en el plan anual de trabajo. |

> Verificado contra el PDF oficial de MinTrabajo el 2026-09-26 (arts. 3, 7, 9,
> 16, 27, 28 y 30). Sigue sin verificar el mapeo de los 7 y 21 a numerales: ver
> `_no_verificado` en `data/estandares_minimos.json`.

## Ciclo anual

1. **Diciembre** — aplicar la autoevaluacion con la tabla de valores del art. 27
2. **Diciembre** — elaborar el plan de mejoramiento segun el resultado
3. **Diciembre** — formular el plan anual del SG-SST de la vigencia siguiente
4. **1 de enero** — iniciar ejecucion del plan de mejoramiento
5. **Fecha fijada por circular** — cargar autoevaluacion y plan en
   `https://sgrl.mintrabajo.gov.co/`

Para la vigencia 2025 el plazo de cargue fue el 31 de julio de 2026
(Circular 027 de 2026). **Ese plazo cambia cada anio**: parametro, no constante.

## Diseno del modulo (M11)

### Autoevaluacion asistida, no formulario
Un estandar se marca como cumplido **solo si existe el documento soporte
cargado en el sistema**. El puntaje deja de ser una declaracion y pasa a ser una
consecuencia del estado real del expediente. Ese es el argumento comercial: el
software no *registra* el cumplimiento, lo *calcula*.

### Trazabilidad estandar → evidencia
Relacion many-to-many entre `estandar_minimo` y `documento_sst`. Al hacer clic
en un estandar, se ven los documentos que lo sustentan con fecha y firma. Eso
convierte la visita del Ministerio en una demostracion de pantalla.

### Simulacion de brechas
Modo "que pasa si": cuantos puntos gana la empresa al cerrar cada brecha,
ordenados por relacion puntaje/esfuerzo. Convierte el plan de mejoramiento en
una ruta priorizada en vez de una lista.

### Exportacion para cargue
Generar el formato de la tabla de valores listo para subir al aplicativo del
Ministerio, mas el plan de mejoramiento.

## Pseudocodigo del calculo

```
conjunto = resolverAplicabilidad(empresa.trabajadores, empresa.clase_riesgo)
total = 0
para cada estandar en conjunto:
    si estandar.no_aplica y estandar.justificacion:
        continuar                      # no suma ni resta
    si existeEvidenciaVigente(estandar, empresa, vigencia):
        estandar.cumple = true
        total += estandar.peso
calificacion = redondear(total, 1)
valoracion = calificacion < 60 ? 'CRITICO'
           : calificacion <= 85 ? 'MODERADAMENTE_ACEPTABLE'
           : 'ACEPTABLE'
```

`existeEvidenciaVigente()` es la funcion clave del producto: cruza el estandar
con los tipos documentales que lo soportan y verifica que existan, esten
firmados y no esten vencidos para la vigencia evaluada.
