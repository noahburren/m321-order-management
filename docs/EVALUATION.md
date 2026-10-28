# Bewertungsnachweise M321

| Kriterium | Technischer Nachweis | Zielniveau |
|---|---|---|
| Architektur und Dokumentation | `README.md`, `docs/ARCHITECTURE.md`, Mermaid, Grenzen, Datenflüsse und Deployment | Maximal |
| Schnittstellen und Kontrakte | versionierte OpenAPI/AsyncAPI, getrennte DTOs, Fehlerantworten, Contractprüfung in `test.ps1` | Maximal |
| Asynchronität und Idempotenz | durable Queues, persistente Zustellung, Confirms, Outbox beidseitig, persistente Inbox, Retry/DLQ, Duplicate-Demo | Maximal |
| Security und Login | Keycloak, Authorization Code + PKCE, JWT-Validierung, USER/ADMIN, 401/403-Tests und Swagger OAuth | Maximal |
| Observability | JSON-Logs, Correlation-ID, trace/span IDs, AMQP Observations, OpenTelemetry/Jaeger und Actuator/Prometheus | Maximal |
| Skalierbarkeit und Resilienz | 0..20 Worker, Competing Consumers, clusterweite Idempotenz, Backpressure, Graceful Shutdown und Recovery | Maximal |
| Evolution und Breaking Changes | parallele v1/v2-Endpunkte, Event-Versionierung, Tolerant Reader, Expand-and-Contract und Kompatibilitätstest | Maximal |
| Autonomie und Deployment | getrennte Repositories, keine Domain-JAR, isolierte DB-Benutzer/Schemas, Container, CI und Ein-Befehl-Start | Maximal |
| Live-Demo/Systemdurchstich | `demo.ps1` prüft den vollständigen Ablauf und liefert bei Fehlern einen Exit-Code ungleich null | Maximal |

Die Tabelle beschreibt die angestrebte technische Abdeckung; die definitive Punktevergabe bleibt Sache der Lehrperson. Vorhandener Code allein gilt nicht als ausgeführter Testnachweis.

## Relevante Codepfade

- Order-Persistenz: `m321-order-service/src/main/resources/db/migration/V1__order_service.sql`
- Order-Outbox: `m321-order-service/src/main/java/ch/tbz/m321orderservice/messaging/OrderOutboxRepository.java`
- Processing-Inbox: `m321-processing-service/src/main/java/com/example/m321processingservice/service/ProcessingInboxRepository.java`
- Processing-Transaktion: `m321-processing-service/src/main/java/com/example/m321processingservice/service/OrderProcessingService.java`
- RabbitMQ/DLQ: beide `RabbitMQConfig.java`
- Security: `m321-order-service/src/main/java/ch/tbz/m321orderservice/security/SecurityConfig.java`
- Securitytests: `m321-order-service/src/test/java/ch/tbz/m321orderservice/SecurityIntegrationTests.java`
- zentrale Orchestrierung: `docker-compose.yml`, `start.ps1`, `demo.ps1`, `test.ps1`
