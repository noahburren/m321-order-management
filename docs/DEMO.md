# Reproduzierbare Live-Demo (ca. 15 Minuten)

## Vorbereitung

```powershell
cd C:\m321
.\start.ps1
.\test.ps1 -SkipImageBuild
```

Öffne UI, RabbitMQ, Jaeger und Prometheus über die vom Startskript angezeigten URLs. Demo-Zugangsdaten stehen in `.env`.

## Ablauf

1. In der UI über Keycloak anmelden. Der Browser nutzt Authorization Code + PKCE; Tokens nicht projizieren.
2. API v1 auswählen, Bestellung erstellen und Order-/Correlation-ID zeigen.
3. Zu API v2 wechseln und eine zweite Bestellung erstellen. Beide wechseln zu `PROCESSED`.
4. RabbitMQ Exchange, durable Queues, Nachrichten und Consumer zeigen.
5. Logs nach der Correlation-ID filtern und denselben Vorgang in beiden Services zeigen.
6. Jaeger-Traces und Prometheus-Targets zeigen.
7. `set-workers.ps1 0`; Bestellung erstellen. Sie bleibt angenommen und in `orders.processing` bereit.
8. `set-workers.ps1 1`; die wartende Bestellung wird verarbeitet.
9. `set-workers.ps1 2`; mehrere Bestellungen erstellen und beide Consumer zeigen.
10. Den vollständigen automatisierten Nachweis ausführen:

```powershell
.\demo.ps1
```

Das Skript prüft: Keycloak-Token, v1/v2, Statusrückkanal, null Worker und Pufferung, Recovery, zwei Competing Consumers, sechs skalierte Bestellungen, eine absichtlich doppelte Nachricht, persistente Deduplizierung, begrenzte Fehlversuche mit DLQ sowie Statuspersistenz nach Service-Neustart. Tokens und Passwörter werden nicht ausgegeben.

## Correlation und Traces

```powershell
.\logs.ps1 -Service all | Select-String 'demo-'
```

In Jaeger nach `m321-order-service` beziehungsweise `processing-service` suchen. Die Werte `demo-v1-correlation`, `demo-v2-correlation`, `demo-buffer-correlation` und `demo-dlq-correlation` bleiben als fachliche Korrelation stabil.

## Aufräumen

```powershell
.\set-workers.ps1 1
.\stop.ps1
```

Die Daten bleiben erhalten. Die absichtliche `FAIL-DEMO`-Nachricht bleibt als Nachweis in `orders.processing.dlq`.
