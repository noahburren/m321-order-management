# Übergabe an Levi – Processing-Service

Die Processing-Änderungen liegen lokal auf dem Branch `codex/maximal-reliability`. Es wurde kein Commit erstellt und nichts gepusht. Levi soll den Diff gegen `main` prüfen, die fachlich gewünschten Änderungen selbst committen und in sein Repository übernehmen.

## Inhalt des Changesets

- PostgreSQL-/Flyway-Persistenz im autonomen Schema `processing_service`
- persistente Inbox mit eindeutigem `event_id` für clusterweite Idempotenz
- Behebung des kritischen Fehlers: Ein Event wird nur in derselben Transaktion wie erfolgreiche Verarbeitung und Outbox-Eintrag als `DONE` gespeichert; ein Fehler rollt den Inbox-Claim zurück
- Transactional Outbox für `OrderProcessed` und Publisher Confirm
- dauerhafte Queue, Retry mit höchstens drei Versuchen, Dead-Letter-Exchange und `orders.processing.dlq`
- Actuator Readiness/Liveness, Prometheus, strukturierte JSON-Logs und OpenTelemetry/Jaeger
- Graceful Shutdown, Docker-Healthcheck-Unterstützung und CI-Workflow
- aktualisierter AsyncAPI-Vertrag und Tests
- absichtlicher, konfigurierbarer `FAIL-DEMO`-Produktcode für den reproduzierbaren Retry-/DLQ-Nachweis

## Prüfung durch Levi

```powershell
cd C:\m321\m321-processing-service
git status
git diff main
mvn --% -Dmaven.repo.local=C:\m321\.m2-build-cache clean test
```

Erwarteter Teststand im vorbereiteten Workspace: 8 Tests, 0 Fehler. Die vollständige Integration wird aus `C:\m321` mit `test.ps1` und `demo.ps1` geprüft.

## Wichtige Review-Pfade

- `src/main/java/com/example/m321processingservice/service/OrderProcessingService.java`
- `src/main/java/com/example/m321processingservice/service/ProcessingInboxRepository.java`
- `src/main/java/com/example/m321processingservice/messaging/ProcessingOutboxRepository.java`
- `src/main/java/com/example/m321processingservice/messaging/ProcessingOutboxPublisher.java`
- `src/main/java/com/example/m321processingservice/config/RabbitMQConfig.java`
- `src/main/resources/db/migration/V1__processing_service.sql`
- `src/main/resources/application.properties`
- `docs/asyncapi.yaml`
- `.github/workflows/ci.yml`
