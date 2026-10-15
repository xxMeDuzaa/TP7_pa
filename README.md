# RutaSur — seguimiento de envíos orientado a eventos

Trabajo práctico 7 · Programación Avanzada 2026 · Licenciatura en Sistemas de Información (FCyT, UADER)

**Autora:** Melina Mas Duarte

Plataforma de seguimiento de envíos en tiempo real para un operador de última milla ficticio, de punta a punta:
desde la generación de eventos hasta el tablero del supervisor. Cada cambio de estado de un envío es un evento;
eso permite **intervenir durante la operación** en lugar de analizar los fracasos al día siguiente.

**Stack:** Apache Kafka (log de eventos, modo KRaft) · Node.js (simulador y servicios) · MongoDB (modelo de lectura,
replica set de un nodo) · Next.js (interfaz). Todo corre en local con Docker Compose.

---

## Arranque

Requisito: Docker Desktop (o Docker Engine + Compose v2). Nada más.

```bash
docker compose up -d --build
```

| URL | Qué es |
|---|---|
| http://localhost:3000 | Torre de control (supervisor) |
| http://localhost:3000/tracking | Tracking público (destinatario) |
| http://localhost:3000/analitica | Panel analítico (gerencia) |
| http://localhost:3000/demo | Panel de demo (escenarios del simulador) |
| http://localhost:8080 | Kafka UI: topics, mensajes, DLQ y lag por grupo |
| http://localhost:4000/estado | Estado del simulador (reloj simulado, estadísticas) |

El primer arranque tarda unos minutos (descarga imágenes y compila Next.js). El simulador empieza a publicar
apenas los topics están creados.

Para empezar de cero (borra Kafka, MongoDB y el estado del simulador):

```bash
docker compose down -v
```

Hacelo también si Docker se cerró de golpe (PC suspendida o apagada, contenedores en `Exited (137)`).
Kafka, MongoDB y el simulador pueden quedar en momentos distintos, por ejemplo con el reloj del monitor de SLA
adelantado al del simulador y alertas `VENCIDO` en envíos recién creados. Como todos los datos son simulados,
lo más simple es borrar todo y volver a levantar el entorno con `docker compose up -d --build`.

---

## Arquitectura

```
                         ┌──────────────────────────────────┐
                         │          Apache Kafka            │
┌────────────┐ publica   │  envios.estados          (3 p.)  │   consume/publica   ┌────────────────┐
│ Simulador  │──────────▶│  envios.promesas  (compactado)   │◀──────────────────▶│ Proyector      │──┐
│ (escenarios│           │  envios.reprogramaciones         │◀──────────────────▶│ Notificaciones │  │
│  + HTTP)   │           │  alertas.sla                     │◀──────────────────▶│ Reprogramación │  │  escriben
└────────────┘           │  notificaciones.enviadas         │◀──────────────────▶│ Monitor de SLA │  │  vistas
                         │  envios.estados.dlq              │◀──────────────────▶│ Analítica      │──┤
                         └──────────────────────────────────┘                    └────────────────┘  ▼
                                                                                   ┌──────────────────────┐
                                    change streams + Server-Sent Events            │ MongoDB (rs0)        │
                          ┌──────────────────┐ ◀────────────────────────────────── │ vistas de lectura    │
                          │ Next.js (lee)    │                                     └──────────────────────┘
                          └──────────────────┘
```

- **Kafka es el único punto de contacto entre servicios**: ninguno llama a otro en forma directa.
- Cada servicio es **un proceso Node.js separado** (un contenedor cada uno), con su **propio grupo de consumidores**.
  Se puede detener uno durante la demo sin afectar a los demás.
- MongoDB guarda **vistas derivadas**, no la fuente de verdad: cualquier colección se puede borrar y reconstruir
  releyendo Kafka desde el principio.
- Next.js **solo lee de MongoDB**; nunca consume Kafka.

### Componentes

| Componente | Proceso | Grupo | Lee | Publica / escribe |
|---|---|---|---|---|
| Simulador | `src/simulador/index.js` | — | — | `envios.estados`, `envios.promesas` |
| Proyector | `src/servicios/proyector` | `proyector` | estados, promesas, reprogramaciones, alertas, notificaciones | `envios`, `alertas`, `notificaciones` |
| Notificaciones | `src/servicios/notificaciones` | `notificaciones` | estados, alertas | `notificaciones.enviadas` |
| Reprogramación | `src/servicios/reprogramacion` | `reprogramacion` | estados | `envios.reprogramaciones` |
| Monitor de SLA | `src/servicios/monitor-sla` | `monitor-sla` | estados, promesas | `alertas.sla` (+ respaldo en `monitor_sla_estado`) |
| Analítica | `src/servicios/analitica` | `analitica` | estados, promesas | `metricas_diarias` |
| 4.º indicador | `src/servicios/analitica-tiempo-hub` | `analitica-tiempo-hub` | estados | `metricas_tiempo_hub` |
| Interfaz | `web/` (Next.js 14) | — | MongoDB | — |

Todos los consumidores pueden publicar en `envios.estados.dlq`.

### Estructura del repositorio

```
docker-compose.yml          entorno completo (un solo comando)
backend/
  src/shared/               config, catálogo de topics, esquemas, tiempo, reglas, esqueleto de consumidor
  src/simulador/            motor determinístico (motor.js) + proceso con reloj acelerado y API HTTP (index.js)
  src/servicios/<servicio>/ index.js (proceso) + lógica pura testeable (proyeccion.js, reglas-sla.js, ...)
  src/scripts/              crear-topics, lag, ver-dlq, reprocesar, snapshot, recuento
  test/                     tests unitarios (node --test, sin dependencias)
web/
  app/                      páginas (torre, envíos/[id], tracking, analítica, demo) y route handlers (API + SSE)
  components/               componentes cliente que aplican los cambios en vivo
  lib/                      conexión a Mongo, consultas, SSE, formatos
```

---

## Eventos

Clave de partición: **siempre `shipmentId`** (garantiza el orden de los eventos de un mismo paquete).
`envios.estados` tiene 3 particiones para mostrar paralelismo y rebalanceo.

| Topic | Produce | Consume | Retención |
|---|---|---|---|
| `envios.estados` | Simulador | Proyector, monitor de SLA, notificaciones, reprogramación, analítica | 30 días |
| `envios.promesas` | Simulador | Monitor de SLA (+ proyector y analítica, ver supuestos) | Compactado |
| `envios.reprogramaciones` | Reprogramación | Proyector | 30 días |
| `alertas.sla` | Monitor de SLA | Proyector, notificaciones | 7 días |
| `notificaciones.enviadas` | Notificaciones | Proyector | 7 días |
| `envios.estados.dlq` | Cualquier consumidor | Revisión manual (`ver-dlq.js`, Kafka UI) | 30 días |

Campos comunes: `eventId`, `shipmentId`, `tipo`, `ocurridoEn`, `secuencia` (en estados), `hubId`, `zonaId`,
`repartidorId`, `version`. Campos propios: `intento` (en `CLASIFICADO`, `EN_REPARTO`, `ENTREGADO`, `ENTREGA_FALLIDA`),
`motivo` (en `ENTREGA_FALLIDA`), `venceEn` (promesa), `regla`/`prioridad`/`alertaId` (alertas), etc.
Los esquemas están en `backend/src/shared/esquemas.js`.

Dos tiempos: `ocurridoEn` lo fija el origen (reloj **simulado**) y el timestamp de Kafka indica cuándo llegó
(reloj real). La torre de control usa este último para mostrar la **latencia evento → pantalla**.

## Modelo de datos en MongoDB

| Colección | Contenido | Escribe | Índices |
|---|---|---|---|
| `envios` | Un documento por envío: estado, situación, promesa, intentos, historial embebido, resolución, resumen de alertas, última secuencia | Proyector | `shipmentId` único; `estado + zonaId`; `promesa.venceEn` |
| `alertas` | Alertas de SLA abiertas y cerradas, con causa y prioridad | Proyector | `estado + prioridadOrden`; `shipmentId` |
| `notificaciones` | Cada notificación simulada | Proyector | `shipmentId` |
| `metricas_diarias` | Agregados por día, zona y franja (incluye hub) | Analítica | `fecha + zonaId + franja` único |
| `eventos_procesados` | `eventId` ya aplicados por cada consumidor | Cada consumidor | `consumidor + eventId` único; TTL 7 días |
| `monitor_sla_estado` | Respaldo del estado interno del monitor | Monitor de SLA | `shipmentId` único |
| `metricas_tiempo_hub` | 4.º indicador | `analitica-tiempo-hub` | `fecha + hubId` único |

El historial va embebido porque está acotado (menos de 15 eventos) y siempre se lee junto con el estado.
`metricas_diarias` se actualiza con incrementos atómicos (`$inc`), así el tablero no recalcula nada.

---

## Cómo se garantiza cada cosa

**Al menos una vez + consumidores idempotentes** (`backend/src/shared/consumidor.js`). Por cada mensaje:

1. Se valida el esquema. Si no cumple → `envios.estados.dlq` con el motivo, se confirma el offset y **el consumo continúa**.
2. Si el `eventId` ya está en `eventos_procesados` para ese consumidor → se descarta (duplicado).
3. El servicio publica sus eventos derivados con **`eventId` determinístico** (`notif-<origen>`, `reprog-<origen>`,
   `alerta-<envío>-<regla>-abierta`). Si se reprocesa el mismo evento, se publica *exactamente* el mismo evento y
   los consumidores de abajo lo descartan.
4. En **una transacción de MongoDB** se registra el `eventId` y se aplican los efectos (proyección, `$inc`, etc.).
5. Recién entonces se **confirma el offset a mano** (`autoCommit: false`). Si el proceso muere antes, Kafka vuelve
   a entregar el mensaje y los pasos 2 y 4 evitan efectos dobles.

**Orden** (CU1): un evento con `secuencia` menor o igual a la ya aplicada se descarta (no hace retroceder el estado).
El documento final no depende del intercalado entre topics distintos (historial ordenado por secuencia, resolución
del intento más alto, alertas por regla, timestamps de Kafka en vez de la hora de proceso). Por eso **borrar y
reprocesar deja exactamente el mismo resultado** (se verifica con `snapshot.js`).

**Monitor de SLA** (CU3): estado en memoria (último estado + vencimiento por envío) construido cruzando
`envios.estados` y `envios.promesas`, con respaldo en `monitor_sla_estado`. Evalúa al recibir cada evento **y cada
segundo real (~2 minutos simulados)** para todos los envíos abiertos: la alerta nace de la *ausencia* de un evento.
Usa el **reloj simulado** de los eventos (marca de agua = mayor `ocurridoEn` visto) menos una tolerancia de 10 minutos
simulados para eventos que llegan tarde. Una regla no vuelve a alertar sobre el mismo envío. Al llegar `ENTREGADO`
emite el cierre de las alertas abiertas. Tras un reinicio restaura su estado desde MongoDB; si llegara a re-emitir
una alerta, tiene el mismo `eventId` y se descarta.

| Regla | Condición | Prioridad |
|---|---|---|
| `SIN_INGRESO` | Faltan menos de 10 h para el vencimiento y no ingresó al hub | Media |
| `SIN_SALIDA` | Faltan menos de 4 h y no está en reparto | Alta |
| `FALLO_DIA_LIMITE` | `ENTREGA_FALLIDA` y la promesa vence ese día | Alta |
| `VENCIDO` | Pasó el vencimiento sin `ENTREGADO` | Crítica |

**Reprogramación** (CU2): `AUSENTE` → nuevo intento el día hábil siguiente en la franja opuesta;
`DIRECCION_INCORRECTA` → retenido; `RECHAZADO` → devolución; tercer intento fallido (cualquier motivo) → devolución.

**Analítica** (CU4): tasa de entrega en primer intento (zona, franja, día), distribución de motivos (zona, motivo)
y cumplimiento de SLA (hub, día). La fecha y la franja salen de `ocurridoEn`, no de cuándo se procesó.

---

## Simulador

Reemplaza a los sistemas de origen. Es una **simulación de eventos discretos sobre un reloj simulado**
(`motor.js` es puro y no conoce Kafka): con la misma semilla produce exactamente la misma secuencia de mensajes.

| Parámetro (variable de entorno) | Valor por defecto |
|---|---|
| Envíos por minuto (`SIM_ENVIOS_POR_MINUTO`) | 20 |
| Factor de aceleración (`SIM_FACTOR`) | 120 → 1 hora simulada = 30 segundos |
| Tasa de fallo por zona | 5 % a 30 % según la zona (más alta a la mañana: ausencias) |
| Distribución de motivos | 60 % ausente, 20 % dirección, 15 % rechazo, 5 % zona |
| Probabilidad de demora en hub (`SIM_PROB_DEMORA`) | 10 % |
| Probabilidad de duplicado (`SIM_PROB_DUPLICADO`) | 2 % |
| Probabilidad de evento fuera de orden (`SIM_PROB_FUERA_DE_ORDEN`) | 2 % |
| Probabilidad de evento malformado (`SIM_PROB_MALFORMADO`) | 1 % |
| Semilla (`SIM_SEMILLA`) | 42 |
| Inicio del reloj simulado (`SIM_INICIO`) | lunes 5/10/2026 09:00 (UTC-3) |

Operación simulada: 3 hubs, 8 zonas, 120 repartidores; salidas de reparto a las 08:00 y 14:00 de lunes a viernes;
promesa = 20:00 del día hábil siguiente a la creación.

Escenarios a pedido (panel de demo o `POST http://localhost:4000/escenarios/<nombre>`):
`feliz`, `ausente`, `demorado`, `tercer-fallo`, `rafaga` (500 envíos), `malformado`. También `POST /pausa` y `/reanudar`.

El simulador guarda su reloj y contadores en un volumen, así un reinicio no hace retroceder el tiempo simulado
ni repite identificadores.

---

## Guion de la demo (~15 minutos)

Los comandos funcionan igual en PowerShell, CMD o bash, desde la carpeta del proyecto.

1. **Arranque.** `docker compose up -d --build`. Abrir la torre de control: los contadores se mueven solos.
2. **Envío feliz.** En el panel de demo, *Envío feliz* → abrir el link de *tracking*. Llega a *Entregado* en ~1 minuto.
   *Concepto: productor, consumidor y proyección.*
3. **Ausente.** *Ausente* → abrir el detalle del envío. Aparecen casi a la vez la notificación, la reprogramación y
   el incremento en analítica. *Concepto: tres grupos de consumidores sobre un mismo evento.*
4. **Demorado.** *Demorado* → a los ~3 minutos aparece en la cola de alertas con prioridad **ALTA**, antes del
   vencimiento; cuando se entrega, la alerta se cierra. *Concepto: procesamiento con estado y tiempo.*
5. **Caída de un servicio.**
   ```bash
   docker compose stop notificaciones
   docker compose run --rm herramientas node src/scripts/lag.js     # el lag de 'notificaciones' crece
   docker compose start notificaciones                              # procesa lo pendiente sin duplicar avisos
   ```
   El tracking y las alertas siguen funcionando. *Concepto: aislamiento, offsets e idempotencia.*
6. **Evento inválido.** *Evento inválido* → `docker compose run --rm herramientas node src/scripts/ver-dlq.js`
   (o Kafka UI → `envios.estados.dlq`). El resto del flujo no se detiene. *Concepto: manejo de errores.*
7. **Analítica.** Abrir el panel: la zona y la franja con más fallos aparecen destacadas (con los parámetros por defecto
   suelen ser Z-C3 o Z-S2, a la mañana, por ausencias) → mejora: ofrecer franja vespertina en esa zona.
8. **Reprocesamiento.** `docker compose --profile reproceso up -d analitica-tiempo-hub` → recargar analítica: el 4.º
   indicador se completa con datos **anteriores a su creación**. *Concepto: retención y replay.*

Los pasos 5 y 8 son los que distinguen esta solución de una basada en una cola tradicional o en REST encadenado.

---

## Criterios de aceptación y cómo verificarlos

**Ciclo de vida**
- [x] Un envío simulado aparece en la torre de control y en el tracking público con su estado correcto → paso 2.
- [x] Un evento duplicado no agrega una entrada repetida al historial → `eventos_procesados` + secuencia; en el detalle
  de cualquier envío el historial no repite `eventId` (los duplicados aparecen como `duplicado descartado` en
  `docker compose logs proyector`).
- [x] Un evento fuera de orden no hace retroceder el estado → regla de secuencia (log `fuera de orden`).
- [x] Un evento malformado termina en la DLQ con su motivo → paso 6.

**Entrega fallida**
- [x] Un `ENTREGA_FALLIDA` genera exactamente una notificación y una reprogramación → paso 3 (`eventId` determinísticos).
- [x] Cada motivo aplica su regla de reprogramación → `test/dominio.test.js`, detalle del envío (recuadro de resolución).
- [x] El tercer fallo marca el envío para devolución → escenario *Tercer fallo*.
- [x] Detener un servicio no afecta a los otros dos → paso 5.

**Riesgo de SLA**
- [x] Cada una de las cuatro reglas genera su alerta con la prioridad definida → cola de alertas; `test/servicios.test.js`.
- [x] Una misma regla no alerta dos veces sobre el mismo envío.
- [x] La alerta se cierra cuando el envío se entrega → escenario *Demorado*.
- [x] Tras reiniciar el monitor no se pierden ni se repiten alertas → `docker compose restart monitor-sla`
  (estado respaldado en MongoDB + `eventId` determinístico).

**Analítica y reprocesamiento**
- [x] Los tres indicadores coinciden con un recuento manual sobre una corrida con semilla fija → pausar el flujo en el
  panel de demo, esperar lag 0 y correr `docker compose run --rm herramientas node src/scripts/recuento.js`
  (lee Kafka directamente y compara con `metricas_diarias`).
- [x] El cuarto indicador se completa con datos históricos sin reiniciar los demás servicios → paso 8.
- [x] Borrar `envios` y reprocesar deja la colección en el mismo estado:
  ```bash
  # pausar el flujo en el panel de demo y esperar lag 0
  docker compose run --rm herramientas node src/scripts/snapshot.js envios
  docker compose stop proyector
  docker compose run --rm herramientas node src/scripts/reprocesar.js proyector --solo-envios
  docker compose start proyector
  docker compose run --rm herramientas node src/scripts/snapshot.js envios   # misma huella
  ```

**Entorno**
- [x] Todo el sistema se levanta con un solo comando en una máquina limpia → `docker compose up -d --build`.
- [x] Latencia evento → pantalla menor a 2 s → indicador *Latencia* en la torre de control.

### Requisitos no funcionales

| Requisito | Cómo se cumple |
|---|---|
| Latencia < 2 s | Change streams de MongoDB → SSE → la torre refresca agrupando cambios cada 250 ms. Se mide en pantalla. |
| Recuperación | Offsets confirmados a mano después de escribir; `eventos_procesados` evita efectos dobles. |
| Reconstrucción | `reprocesar.js` borra las vistas del grupo y lleva sus offsets al principio; `snapshot.js` compara huellas. |
| Aislamiento | Un proceso y un grupo de consumidores por servicio; sólo se comunican por Kafka. |
| Observabilidad | Cada servicio loguea `eventId`, partición y offset (JSON por línea: `docker compose logs -f proyector`); lag con `lag.js` (`--seguir` para verlo en vivo) o Kafka UI. |
| Arranque | `docker compose up -d --build`. |

---

## Decisiones de diseño

| Decisión | Elección | Motivo | Alternativa descartada |
|---|---|---|---|
| Garantía de entrega | Al menos una vez, consumidores idempotentes | Simple y no pierde eventos | Exactamente una vez con transacciones de Kafka |
| Confirmación de offsets | Manual, después de escribir en MongoDB | Un fallo a mitad de proceso reintenta el evento | Confirmación automática |
| Particiones de `envios.estados` | 3 | Muestra reparto de carga y rebalanceo | 1 partición |
| Formato de eventos | JSON con validación de esquema en cada consumidor | Legible y sin componentes extra | Avro con Schema Registry |
| Monitor de SLA | Consumidor propio con estado en memoria y respaldo en MongoDB | La lógica queda a la vista | Kafka Streams / ksqlDB |
| Kafka en local | Un broker en modo KRaft | Un solo contenedor, sin ZooKeeper | Clúster de 3 brokers |
| Tiempo real en la interfaz | Change streams + SSE | El frontend no depende de Kafka | Consumir Kafka desde Next.js |
| Efectos en MongoDB | Transacción (registro del `eventId` + efectos) | Un reintento nunca cuenta dos veces | Escrituras sueltas |
| Simulador | Eventos discretos sobre reloj simulado, semilla fija | Corridas reproducibles | Temporizadores con el reloj real |

### Supuestos propios (lo que la especificación no fija)

- **`ZONA_INACCESIBLE`**: nuevo intento el día hábil siguiente en la **misma** franja (la especificación no define la regla).
- **Franjas**: mañana 08–14 h y tarde 14–20 h (hora de Argentina). Días hábiles: lunes a viernes.
- **Promesa de entrega**: 20:00 del día hábil siguiente a la creación.
- **Cumplimiento de SLA**: porcentaje de entregados con `ENTREGADO.ocurridoEn <= venceEn`, por hub y día de entrega.
- **`envios.promesas`** también la leen el proyector (para mostrar la fecha estimada) y la analítica (para el SLA).
  En la tabla de topics figura solo el monitor de SLA.
- **Devolución al comercio**: además del `ENTREGADO`, el monitor de SLA cierra las alertas de un envío que vuelve al
  comercio (ya salió del circuito); usa la misma política compartida que el servicio de reprogramación. Los
  retenidos siguen vigilados porque requieren intervención.
- **DLQ**: cada grupo de consumidores valida por su cuenta, así que un evento malformado deja un registro por grupo
  (indica qué consumidor lo rechazó).
- **Escenario *Tercer fallo***: los reintentos están comprimidos (minutos simulados) para que entre en la demo.
  En el flujo continuo y en *Ausente* se respeta la regla del día hábil siguiente.

---

## Tests

La lógica de negocio está separada de Kafka y MongoDB, así que se prueba sin infraestructura (Node 20+, sin instalar nada):

```bash
cd backend
npm test
```

Cubre: tiempo y días hábiles, reglas de reprogramación, esquemas, determinismo del simulador (misma semilla → misma
corrida), escenarios, proyección independiente del orden entre topics, las cuatro reglas de SLA, cierre de alertas
e incrementos de la analítica.

## Comandos útiles

```bash
docker compose ps                                             # estado de los contenedores
docker compose logs -f proyector                              # logs (eventId, partición, offset)
docker compose run --rm herramientas node src/scripts/lag.js --seguir
docker compose run --rm herramientas node src/scripts/ver-dlq.js
docker compose run --rm herramientas node src/scripts/recuento.js
docker compose restart monitor-sla                            # prueba de tolerancia a reinicios
```
