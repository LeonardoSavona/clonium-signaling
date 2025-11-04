const express = require("express");
const cors = require("cors");
const http = require("http");
const { WebSocketServer } = require("ws");

const app = express();
app.use(cors());
app.use(express.json());

/**
 * In-memory store per le stanze.
 * Chiave: roomId
 * Valore: oggetto stanza + dati signaling.
 *
 * ATTENZIONE: è solo in memoria, se il server si riavvia si perde tutto.
 * Per un gioco personale va benissimo.
 */
const rooms = new Map();

/** Connessioni WebSocket collegate a /rooms */
const wsClients = new Set();

/**
 * Crea uno snapshot "pulito" delle stanze da inviare ai client.
 * Qui decidi quali campi servono alla lobby del gioco.
 */
function getRoomsSnapshot() {
  return Array.from(rooms.values()).map((room) => ({
    roomId: room.roomId,
    name: room.name || room.roomId,
    isPublic: room.isPublic !== false,
    maxPlayers: room.maxPlayers || 4,
    players: room.players || 1,
    lastHeartbeat: room.lastHeartbeat || Date.now()
  }));
}

/** Manda la lista stanze aggiornata via WS a tutti i client connessi. */
function broadcastRooms() {
  const payload = JSON.stringify({ rooms: getRoomsSnapshot() });
  for (const ws of wsClients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

/**
 * Healthcheck / info base
 */
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "clonium-signaling-server" });
});

/**
 * POST /rooms
 * Body = RegisterRoomRequest dal client Java.
 * Ci aspettiamo almeno: roomId (string).
 * Altri campi (name, isPublic, maxPlayers, ecc.) sono opzionali ma utili.
 */
app.post("/rooms", (req, res) => {
  const room = req.body;

  if (!room || !room.roomId) {
    return res.status(400).json({ error: "roomId is required" });
  }

  // Default sensati
  room.isPublic = room.isPublic !== false;
  room.maxPlayers = room.maxPlayers || 4;
  room.players = room.players || 1;
  room.lastHeartbeat = Date.now();

  rooms.set(room.roomId, room);
  broadcastRooms();

  // Il tuo client si aspetta solo "void"
  res.status(204).send();
});

/**
 * GET /rooms
 * Ritorna l'array di stanze (usato da SignalingService.listRooms()).
 */
app.get("/rooms", (req, res) => {
  res.json(getRoomsSnapshot());
});

/**
 * DELETE /rooms/:roomId
 */
app.delete("/rooms/:roomId", (req, res) => {
  const roomId = req.params.roomId;
  rooms.delete(roomId);
  broadcastRooms();
  res.status(204).send();
});

/**
 * POST /rooms/:roomId/heartbeat
 * Body: { "players": <int> }
 */
app.post("/rooms/:roomId/heartbeat", (req, res) => {
  const roomId = req.params.roomId;
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }

  const { players } = req.body;
  if (typeof players === "number") {
    room.players = players;
  }
  room.lastHeartbeat = Date.now();
  rooms.set(roomId, room);
  broadcastRooms();
  res.status(204).send();
});

/**
 * POST /rooms/:roomId/offer
 * Salva l'OfferMessage per la stanza (WebRTC).
 */
app.post("/rooms/:roomId/offer", (req, res) => {
  const roomId = req.params.roomId;
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }
  room.offer = req.body;
  rooms.set(roomId, room);
  res.status(204).send();
});

/**
 * POST /rooms/:roomId/answer
 * Salva l'AnswerMessage per la stanza (WebRTC).
 */
app.post("/rooms/:roomId/answer", (req, res) => {
  const roomId = req.params.roomId;
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }
  room.answer = req.body;
  rooms.set(roomId, room);
  res.status(204).send();
});

/**
 * POST /rooms/:roomId/ice
 * Aggiunge un IceCandidateMessage alla stanza.
 */
app.post("/rooms/:roomId/ice", (req, res) => {
  const roomId = req.params.roomId;
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }
  if (!room.iceCandidates) {
    room.iceCandidates = [];
  }
  room.iceCandidates.push(req.body);
  rooms.set(roomId, room);
  res.status(204).send();
});

/**
 * Server HTTP + WebSocket /rooms
 */
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const { url } = request;

  // Accettiamo WebSocket solo su /rooms
  if (url === "/rooms") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wsClients.add(ws);

      // Appena connesso, mandiamo subito lo snapshot delle stanze
      ws.send(JSON.stringify({ rooms: getRoomsSnapshot() }));

      ws.on("close", () => {
        wsClients.delete(ws);
      });
    });
  } else {
    socket.destroy();
  }
});

// Render imposta process.env.PORT
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
