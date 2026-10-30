# M321 – Distributed Order Management

Reproduzierbare lokale Integrationsumgebung für drei getrennte Anwendungen:

- **Order-Service (Noah):** REST API v1/v2, Security, Orderstatus und Transactional Outbox
- **Processing-Service (Levi):** konkurrierende RabbitMQ-Worker, persistente Inbox/Idempotenz und Transactional Outbox
- **Order-UI:** React/Vite, Keycloak Login mit Authorization Code + PKCE, Bestellung und Live-Status

Die Backend-Services besitzen getrennte Repositories, Datenbankbenutzer und Schemas. Dieses Verzeichnis enthält die gemeinsame Deployment- und Demo-Konfiguration.

## Voraussetzungen

- Windows 11 und PowerShell 5.1 oder 7
- Docker Desktop mit laufender Linux-Container-Engine
- Für `test.ps1`: Java 17+, Maven, Node.js/npm
- Freie Ports: `5173`, `5432`, `5672`, `8080`, `8081`, `9090`, `15672`, `16686`

## Ein-Befehl-Start

```powershell
cd C:\m321
.\start.ps1
```

Beim ersten Start wird `.env` aus `.env.example` erzeugt. Das Skript validiert Compose, baut Images, startet Container und wartet auf Container-Healthchecks sowie echte HTTP-Readiness-Endpunkte. Bei einem Fehler endet es mit Exit-Code 1 und zeigt Diagnoselogs.

```powershell
.\stop.ps1                 # Stoppen; persistente Daten bleiben erhalten
.\restart.ps1              # Neu starten
.\logs.ps1                 # zentrale Logs
.\logs.ps1 -Service order-service
.\set-workers.ps1 0        # Processing komplett stoppen
.\set-workers.ps1 1        # ein Worker
.\set-workers.ps1 2        # zwei Competing Consumers
.\test.ps1                 # Tests, Contractprüfung und Image-Builds
.\demo.ps1                 # E2E-, Recovery-, Scale-, Duplicate- und DLQ-Test
```

`stop.ps1` löscht keine Volumes. Nur ein ausdrücklich ausgeführtes `docker compose down -v` würde lokale Demodaten löschen.

## URLs

| Dienst | URL |
|---|---|
| React UI | http://localhost:5173 |
| Order API / Swagger | http://localhost:8081/swagger-ui.html |
| Order Readiness | http://localhost:8081/actuator/health/readiness |
| RabbitMQ Management | http://localhost:15672 |
| Keycloak | http://localhost:8080 |
| Prometheus | http://localhost:9090 |
| Jaeger | http://localhost:16686 |

Demo-Benutzer, Passwörter und Infrastruktur-Credentials stehen in der lokalen `.env`. Diese Werte sind ausschliesslich für die lokale Schul-Demo bestimmt und dürfen nicht produktiv verwendet werden. Skripte geben weder Passwörter noch Tokens aus.

## API und Verträge

Beide Varianten laufen parallel und erzeugen dasselbe versionierte `OrderCreated`-Event:

```http
POST /api/v1/orders
{"product":"Keyboard","quantity":2}

POST /api/v2/orders
{"productCode":"KEYBOARD-01","amount":2}
```

Ein Bearer-JWT mit der Realm-Rolle `USER` ist erforderlich. Ein vorhandener `X-Correlation-ID`-Header wird übernommen; ohne Header wird eine UUID erzeugt. Statusabfrage: `GET /api/v1/orders/{orderId}/status`.

Vertragsquellen:

- REST: `m321-order-service/openapi.yaml`
- Events: `m321-order-service/asyncapi.yaml`
- Consumer-Kopie: `m321-processing-service/docs/asyncapi.yaml`

Weitere Nachweise:

- [Architektur und Datenfluss](docs/ARCHITECTURE.md)
- [15-Minuten-Live-Demo](docs/DEMO.md)
- [Bewertungsnachweise](docs/EVALUATION.md)
- [Vertrags- und Breaking-Change-Regeln](docs/CONTRACTS.md)

## Verantwortlichkeiten

| Bereich | Verantwortung |
|---|---|
| `m321-order-service` | Noah |
| `m321-processing-service` | Levi; Änderungen aus dem vorbereiteten Codex-Branch prüfen und selbst übernehmen |
| `m321-order-ui` | gemeinsame Demo-Oberfläche |
| Root-Compose, Infrastruktur und Skripte | gemeinsame Integrationskonfiguration |

Es gibt keine gemeinsame Domain-JAR und keinen direkten fachlichen Datenbankzugriff zwischen Services. Die Integration erfolgt nur über dokumentierte HTTP- und AMQP-Verträge.

## Fehlerbehebung

```powershell
docker compose ps
docker compose logs --tail 150 order-service processing postgres rabbitmq keycloak
docker compose config
```

- **401:** kein oder abgelaufenes JWT; über UI neu anmelden oder `demo.ps1` verwenden.
- **403:** JWT vorhanden, erforderliche Realm-Rolle fehlt.
- **Order bleibt ACCEPTED:** `orders.processing` und Consumerzahl prüfen; Worker mit `set-workers.ps1 1` starten.
- **Nachricht in DLQ:** `orders.processing.dlq` prüfen; `FAIL-DEMO` ist der absichtliche Demo-Fehler.
- **Port belegt:** den belegenden lokalen Prozess stoppen; die Ports sind für Redirect-URIs und Demo-Verträge fest konfiguriert.
- **Start meldet Fehler:** die ausgegebenen Containerlogs verwenden; ein bloss laufender Container zählt nicht als vollständiger Systemerfolg.
