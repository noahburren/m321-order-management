# Verträge und Evolution

## Quellen und Besitz

Der Order-Service besitzt `openapi.yaml` und den publizierten `asyncapi.yaml`. Der Processing-Service hält eine lokale Consumer-Kopie des AsyncAPI-Vertrags; eine gemeinsame Domain-Implementierung existiert nicht. `test.ps1` prüft die kritischen Pfade, Header, Exchange-, Routing- und Queue-Namen in beiden Kopien.

## REST Expand-and-Contract

- v1 bleibt unter `POST /api/v1/orders` mit `product` und `quantity` verfügbar.
- v2 wurde additiv unter `POST /api/v2/orders` mit `productCode` und `amount` eingeführt.
- Beide Controller mappen auf ein internes Kommando und produzieren weiterhin `OrderCreated` Version 1.
- v1 wird erst nach dokumentierter Deprecation, Consumer-Migration und separater Entfernung in einem späteren Release abgebaut.

## Event-Kompatibilität

- Routing Keys und `eventVersion` sind explizit versioniert.
- Felder werden nur additiv und optional ergänzt; bestehende Semantik bleibt stabil.
- Consumer ignorieren unbekannte JSON-Felder (Tolerant Reader).
- Ein inkompatibles Schema erhält einen neuen Routing Key, zum Beispiel `order.created.v2`.
- Während einer Migration publiziert der Producer nötigenfalls beide Versionen aus derselben Outbox; getrennte Queues erlauben parallele Consumer-Deployments ohne Unterbrechung.
- Events besitzen stabile `eventId`, `orderId`, `correlationId` und Zeitstempel. Deduplizierung erfolgt persistent pro `eventId`.

## Fehlerantworten

Validierungsfehler liefern 400 mit strukturierter `ApiErrorResponse`; fehlendes JWT liefert 401, unzureichende Rolle 403, unbekannter Status 404 und nicht verfügbare Persistenz 503. Die OpenAPI-Datei dokumentiert die relevanten Schemas und Antworten.
