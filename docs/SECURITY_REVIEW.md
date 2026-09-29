# MoskiCheck Backend V3: revisión de seguridad y compatibilidad

Fecha: 2026-09-28. Prioridad: compatibilidad con Android, sin cambios de esquema ni de reglas de evaluación.

## Diagnóstico inicial, previo a modificaciones

El repositorio contenía `server.js`, `db.js`, tres routers, `package.json`, `package-lock.json` y `.gitignore`. No contenía modelos ORM, migraciones, esquema SQL, pruebas funcionales ni `.env`. El árbol de trabajo estaba limpio. Se revisaron todos los archivos de aplicación y el frontend disponible en `../mi-app-frontend`.

El servidor ya ocultaba `X-Powered-By`, aceptaba CORS público y limitaba JSON/formularios a 1 MB. Faltaban headers de seguridad y un middleware global de errores JSON. Los fallos de parseo podían devolver HTML. El 404 y diagnósticos usaban `error`, mientras reportes y alertas usaban `mensaje`.

Las consultas utilizaban placeholders para los valores externos, pero aceptaban tipos inesperados, textos vacíos y textos sin límites. La veracidad de JavaScript convertía `"false"` en anonimato verdadero. Registrar objetos de error MySQL completos podía incluir SQL y valores del formulario; el router de diagnósticos registraba también respuestas externas.

`GET /api/reportes` exponía `usuarios.nombre` y `usuarios.apellidos` mediante un JOIN, incluso para reportes anónimos. Android no utiliza esos campos. Un registro antiguo marcado como anónimo podía conservar otro nombre en `reportes.nombre`.

No se encontró autenticación activa. `bcryptjs` y `jsonwebtoken` estaban instalados pero no usados; se conservaron. La escritura de reportes, la evaluación IA y el cálculo de alertas son públicos. El listado completo no tiene paginación y el pool tiene cola ilimitada. Estas limitaciones requieren decisiones separadas para evitar afectar al cliente.

## Rutas y contratos

| Endpoint | Android actual | Respuesta de éxito preservada |
| --- | --- | --- |
| `GET /health` | No referenciado en ApiService | `status`, `service`, `version`; se añaden `ok` y `data` |
| `GET /` | No referenciado en ApiService | `ok`, `mensaje`, `version`, `rutas`; se añade `data` con servicio y versión |
| `GET /api/reportes` | `obtenerReportes()` | `ok`, `data` como lista |
| `GET /api/reportes/por-distrito` | `obtenerReportesPorDistrito()` | `ok`, `data` como lista con todos los contadores |
| `GET /api/reportes/total` | `obtenerTotales()` | `ok`, `data.total_reportes`, `data.total_distritos` |
| `POST /api/reportes` | `enviarReporte()` | HTTP 201, `ok`, `mensaje`, `id` |
| `GET /api/alertas/hoy` | `obtenerAlertaHoy(distrito)` | `ok`, `data`; objeto con distrito, lista sin distrito, objeto de bajo riesgo sin filas |
| `POST /api/alertas/calcular` | No se encontró llamada | `ok`, `mensaje`; se añade `data.total_distritos` |
| `POST /api/diagnosticos/analizar` | `analizarSintomas()` | `ok`, `mensaje`, `resultado_inteligencia_artificial`; se añade `data` con el mismo resultado |

Los errores incorporan `ok: false` y `mensaje`. Se conservan `error` y `detalle` donde existían. Todas las respuestas de éxito contienen `ok` y `data`, sin mover las claves originales que leen los clientes.

Se revisaron `ApiService.kt`, `ReporteApi.kt`, los modelos de alertas/resultados, repositorios, `ReportViewModel.kt`, `ReportScreen.kt`, `ReportsScreen.kt` y las pruebas HTTP existentes del frontend. Android parsea JSON manualmente con `JSONObject`, por lo que los campos adicionales no alteran sus lecturas. Android conserva el identificador del POST mediante `json.getInt("id")` y requiere `resultado_inteligencia_artificial` para la evaluación.

| Campo del listado | Uso en Android | Decisión |
| --- | --- | --- |
| `id` | Modelo/parser | Conservar |
| `nombre` | Modelo/parser/pantalla | Conservar nombre voluntario; devolver `Anónimo` cuando `es_anonimo = 1` |
| `distrito` | Modelo/parser/pantalla | Conservar |
| `barrio` | Modelo/parser | Conservar nullable |
| `tipo_criadero` | Modelo/parser/pantalla | Conservar |
| `descripcion` | Modelo/parser/pantalla | Conservar nullable |
| `foto_path` | No utilizado por el cliente revisado | Conservar por compatibilidad |
| `fecha_hora` | Modelo/parser/pantalla | Conservar tipo/formato del driver |
| `es_anonimo` | Parser `optInt(...) == 1` y pantalla | Conservar representación numérica MySQL |
| `estado` | Modelo/parser obligatorio | Conservar |
| `usuario_nombre`, `usuario_apellidos` | Sin referencias en frontend | Retirar únicamente del SELECT público |

La compatibilidad comprobada corresponde al frontend local disponible. No se ejecutó una app instalada en un dispositivo ni una compilación Kotlin contra el backend modificado.

## Base de datos y modelo de usuarios

Se utiliza un pool de `mysql2` con interfaz Promise, 10 conexiones y credenciales tomadas de `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` y `DB_NAME`. Se mantienen esos nombres, `PORT` y `MOSKICHECK_IA_URL`. `.env` permanece ignorado. `.env.example` contiene exclusivamente valores de ejemplo.

| Tabla | Evidencia de dependencia |
| --- | --- |
| `reportes` | Listado, conteos, ranking semanal, inserción y cálculo de alertas |
| `usuarios` | JOIN original y posible relación de `reportes.usuario_id`; el POST todavía admite un identificador válido |
| `alertas` | Lectura del día e INSERT/UPDATE por distrito y fecha |
| `evaluaciones_moskicheck` | INSERT de 14 síntomas/señales y ocho campos del resultado IA |
| `sintomas` | Únicamente un comentario de compatibilidad histórica; no hay consultas activas |

No se puede determinar si `usuarios` existe, contiene datos o tiene otras dependencias en Railway sin acceder al esquema real. Tampoco se puede declarar obsoleta. No se elimina ninguna tabla, columna ni clave foránea. Retirar el JOIN público no retira el soporte de `usuario_id` en el formulario.

Consultas de solo lectura para completar la comprobación en la base de producción:

```sql
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE,
       CHARACTER_MAXIMUM_LENGTH, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('usuarios', 'reportes', 'alertas', 'evaluaciones_moskicheck', 'sintomas')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME,
       REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND (TABLE_NAME = 'usuarios' OR REFERENCED_TABLE_NAME = 'usuarios');

SELECT COUNT(*) AS reportes_con_usuario
FROM reportes WHERE usuario_id IS NOT NULL;
```

También deben revisarse vistas, triggers, rutinas y servicios externos antes de cualquier retirada futura de `usuarios`.

## Cambios de seguridad

- El listado conserva los diez campos públicos y evita consultar información personal de `usuarios`.
- El SELECT oculta nombres de registros anónimos antiguos sin actualizar filas.
- El POST exige un objeto, texto para los campos de texto, distrito y tipo no vacíos, un ID opcional entero seguro y anonimato booleano/0/1. Acepta sus equivalentes textuales en formularios existentes.
- Los textos se recortan solo en los extremos. Los opcionales vacíos se guardan como `NULL`; el nombre ausente mantiene `Anónimo`.
- Límites: 255 caracteres para nombre/distrito/barrio/tipo, 10 000 para descripción y 2048 para foto. Se rechaza el exceso con HTTP 400 sin truncar. **Estos límites deben cotejarse con el esquema real: no fueron deducidos de columnas de Railway.**
- Las consultas con datos externos usan `execute` y placeholders; `multipleStatements` queda explícitamente desactivado. Las consultas estáticas continúan usando `query` para conservar tipos de los conteos y fechas.
- Se añaden `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` y `Cache-Control: no-store` en `/api/`. CORS conserva la política actual.
- Los errores de JSON, tamaño y codificación devuelven JSON con HTTP 400, 413 o 415; los errores inesperados devuelven 500 genérico.
- Los logs de error guardan contexto, código técnico y estado HTTP externo, sin SQL ni cuerpos de reportes/evaluaciones.
- `server.js` exporta Express para las pruebas; `npm start` conserva el arranque y el puerto suministrado por Railway.

Se mantienen la ventana de siete días, los umbrales de alertas (10/20/30), los 14 valores exactos 0/1, el timeout IA de 15 segundos y los estados `orientation`, `inconclusive` y `alert`. La evaluación continúa perteneciendo al microservicio.

## Dependencias

La instalación inicial detectó cinco dependencias vulnerables: axios, mysql2, body-parser, form-data y qs (dos de severidad alta, dos moderadas y una baja). Se aplicó `npm audit fix` sin `--force`, dentro de los rangos existentes. Se actualizaron también los mínimos directos a axios `^1.20.0` y mysql2 `^3.24.4`. Se conserva Express `5.2.1` y no se añade ninguna dependencia.

El lockfile registra las correcciones y permite instalar lo verificado mediante `npm ci`. Cero avisos en npm audit significa cero vulnerabilidades conocidas por ese servicio en ese momento, no ausencia de toda vulnerabilidad.

## Ejecución de pruebas

```sh
npm install
npm test
npm start
```

`npm test` ejecuta las pruebas HTTP de Express con MySQL/IA simulados. La integración con MySQL real se omite si no está configurado `TEST_MYSQL_PORT`.

Para la integración, iniciar un contenedor **nuevo y desechable** de MySQL; no usar la base de producción. El test conecta exclusivamente a localhost como root sin contraseña, utiliza `moskicheck_test` y crea tablas de fixture. No utiliza las credenciales DB del entorno para esta prueba.

```sh
docker run --detach --rm --name moskicheck-test \
  --publish 127.0.0.1:33316:3306 \
  --env MYSQL_ALLOW_EMPTY_PASSWORD=yes \
  --env MYSQL_DATABASE=moskicheck_test docker.io/library/mysql:8.4
# Esperar a que MySQL esté listo antes de ejecutar:
TEST_MYSQL_PORT=33316 npm test
docker stop moskicheck-test
```

El esquema de fixture permite comprobar SQL, anonimato, inyección, claves foráneas, alertas y persistencia de evaluaciones con MySQL real. **No demuestra que el esquema de Railway coincida.** La IA se simula; no se evalúa el modelo real.

### Resultados obtenidos

Entorno: Node.js `22.23.1`, npm `10.9.8`, MySQL oficial `8.4` en un contenedor desechable. Se utilizó el digest `sha256:f015b98a954d6bb92c370d93f354b85f4bcea15642d9fb2975f841a00d400b65`. Docker Hub descargaba muy lentamente; se obtuvo la misma imagen por digest desde `mirror.gcr.io` y se detuvo la descarga original.

| Verificación | Resultado |
| --- | --- |
| `npm install` | Correcto; dependencias y lockfile sincronizados |
| `npm ls --depth=0` | Correcto; todas las dependencias directas resueltas |
| `npm audit fix` sin `--force` | Corrigió los cinco paquetes vulnerables dentro de las mismas versiones mayores |
| `npm audit --omit=dev` | Cero vulnerabilidades conocidas |
| `node --check` sobre aplicación, utilidades y pruebas | Correcto |
| `git diff --check` | Correcto |
| `npm test` sin MySQL | 15 pruebas HTTP aprobadas; integración omitida explícitamente |
| `TEST_MYSQL_PORT=33316 npm test` | 27 pruebas aprobadas, cero fallos, cero omisiones; incluye 11 comprobaciones de integración y su prueba contenedora |
| `npm start` con variables de la base temporal | Arranque correcto; log `Conectado a MySQL` |
| `GET /health` | HTTP 200; campos originales y campos añadidos correctos |
| `GET /api/reportes` | HTTP 200; diez campos conservados, anonimato protegido, sin nombres/apellidos internos |
| `GET /api/reportes/total` | HTTP 200; contadores numéricos correctos |
| `GET /api/reportes/por-distrito` | HTTP 200; ranking y seis contadores verificables por el parser Android |
| `POST /api/reportes` válido | HTTP 201; `id` principal conservado y fila insertada |
| `POST /api/reportes` inválido | HTTP 400 JSON; sin insertar filas |
| `POST /api/alertas/calcular` | HTTP 200; dos llamadas no duplican filas con la clave de fixture; umbrales preservados |
| `GET /api/alertas/hoy?distrito=Piura` | HTTP 200; objeto y tipos requeridos por Android correctos |
| `POST /api/diagnosticos/analizar` con IA simulada | HTTP 200; respuesta completa conservada y evaluación insertada en MySQL |
| Diagnóstico sin `MOSKICHECK_IA_URL` en servidor iniciado con npm start | HTTP 503 JSON esperado; `mensaje` y `error` compatibles |
| Fallos/timeout o respuesta inválida de IA simulada | HTTP 502 JSON, sin revelar datos externos |
| Fallos de MySQL simulados en todos los endpoints que usan la base | HTTP 500 JSON genérico, sin SQL ni información privada en respuesta o logs |
| Ruta inexistente | HTTP 404 JSON; se conserva `error` y se añade `mensaje` |
| JSON malformado, payload mayor a 1 MB, charset inválido | HTTP 400, 413 y 415 JSON respectivamente |
| Anonimato, nombres voluntarios, formulario urlencoded, textos opcionales vacíos y límites de texto | Correctos |
| Intento de inyección SQL con MySQL real | Se almacena como texto; la tabla usuarios permanece intacta |
| Comparación con ApiService.kt y modelos locales | Rutas, claves utilizadas y tipos conservados; verificación de fuente y contratos HTTP |
| Conexión/esquema real de Railway y modelo IA real | Pendientes por falta de credenciales/configuración accesibles |
| Ejecución Android en dispositivo | No realizada |

La primera instalación y las primeras pruebas locales fueron bloqueadas por permisos del sandbox (caché de npm/sockets `EPERM`). Se repitieron fuera del sandbox con aprobación y terminaron correctamente. Antes de que MySQL temporal estuviese listo hubo `ECONNREFUSED`; el arranque final y las solicitudes posteriores conectaron correctamente.

Se ejecutaron además diez solicitudes de comprobación contra el proceso iniciado mediante **`npm start`**, sin sustituir su conexión MySQL: todas devolvieron el estado y JSON esperados. El backend conserva el comando de arranque y las variables de Railway. La validación local está completa; la aptitud contra la base de producción requiere contrastar su esquema y probar en staging. No se desplegaron estos cambios ni se escribieron registros en producción.

## Archivos modificados y añadidos

| Archivo | Cambio |
| --- | --- |
| `server.js` | Headers, JSON global para errores, respuestas aditivas y exportación de Express para pruebas |
| `db.js` | Nombres de variables preservados, múltiples sentencias desactivadas y logs seguros |
| `routes/reportes.js` | Listado sin datos internos, anonimato, validaciones y POST preparado compatible |
| `routes/alertas.js` | Validación de distrito, SQL preparado y respuesta aditiva; umbrales conservados |
| `routes/diagnosticos.js` | Errores con mensaje compatible, logs seguros y persistencia preparada; IA sin cambio de reglas |
| `package.json` | Comando de pruebas y versiones mínimas corregidas de axios/mysql2 |
| `package-lock.json` | Dependencias corregidas y sincronizadas |
| `utils/validation.js` (nuevo) | Validación y normalización acotadas de reportes/textos |
| `utils/log-error.js` (nuevo) | Registro de códigos sin datos sensibles |
| `test/api.test.js` (nuevo) | Pruebas HTTP de contratos, entradas inválidas y fallos de servicios |
| `test/mysql.integration.test.js` (nuevo) | Pruebas con MySQL desechable real |
| `.env.example` (nuevo) | Configuración de ejemplo sin credenciales reales |
| `docs/SECURITY_REVIEW.md` (nuevo) | Diagnóstico, compatibilidad, dependencias, resultados y pendientes |

## Recomendaciones siguientes

1. Cotejar límites/columnas y probar en un entorno Railway de staging conectado al esquema real antes de promover el cambio.
2. Verificar las relaciones de usuarios y los clientes externos antes de declarar obsoleto ese modelo. No permitir que un usuario se atribuya otro `usuario_id` si se introduce autenticación.
3. Restringir `/api/alertas/calcular` a un proceso programado autorizado tras confirmar sus consumidores. Diseñar límites de frecuencia para escrituras e IA con la configuración de proxy de Railway comprobada.
4. Usar una cuenta MySQL de mínimos permisos y revisar TLS según la conexión disponible en Railway. No activar opciones TLS a ciegas.
5. Planificar paginación compatible, retención y consentimiento para descripciones, fotografías y nombres voluntarios. El listado sigue siendo público.
6. Añadir comprobación de disponibilidad de MySQL separada del health de proceso: `/health` conserva su significado actual y no garantiza que la base esté accesible.
7. Automatizar `npm ci`, `npm test` y `npm audit` en CI y ejecutar pruebas del cliente Android contra staging.

Referencias primarias consultadas: [seguridad de Express](https://expressjs.com/en/advanced/best-practice-security.html), [manejo de errores de Express](https://expressjs.com/en/guide/error-handling/), [consultas preparadas de mysql2](https://sidorares.github.io/node-mysql2/docs/documentation/prepared-statements).
