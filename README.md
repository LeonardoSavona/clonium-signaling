# Clonium Signaling Server

Piccolo server di signaling per il gioco **Clonium** (Java desktop).

Fornisce:

- API HTTP per gestire stanze:
  - `POST /rooms`
  - `GET /rooms`
  - `DELETE /rooms/:roomId`
  - `POST /rooms/:roomId/heartbeat`
  - `POST /rooms/:roomId/offer`
  - `POST /rooms/:roomId/answer`
  - `POST /rooms/:roomId/ice`
- WebSocket su `/rooms` per ricevere in tempo reale la lista aggiornata delle stanze.

Il server è pensato per essere compatibile con la classe Java:

```java
leonardo.savona.clonium.network.signaling.SignalingService
