const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const { WebSocketServer } = WebSocket;

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/rooms' });

const rooms = new Map();
const HEARTBEAT_TIMEOUT = 5 * 60 * 1000; // five minutes
const CLEANUP_INTERVAL = 60 * 1000;

function normaliseBoolean(value, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }
  return Boolean(value);
}

function serialiseRooms() {
  return Array.from(rooms.values()).map((room) => ({
    roomId: room.roomId,
    name: room.name,
    players: room.players,
    maxPlayers: room.maxPlayers,
    public: room.public,
    mode: room.mode,
    hostPeerId: room.hostPeerId,
    joinCode: room.public ? null : room.joinCode
  }));
}

function broadcastRooms() {
  const payload = JSON.stringify({ rooms: serialiseRooms() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

app.get('/rooms', (req, res) => {
  res.json(serialiseRooms());
});

app.post('/rooms', (req, res) => {
  const body = req.body || {};
  const roomId = body.roomId;
  if (!roomId) {
    return res.status(400).json({ error: 'roomId is required' });
  }
  const isPublic = normaliseBoolean(body.public !== undefined ? body.public : body.isPublic, true);
  const entry = {
    roomId,
    name: body.name || 'Room',
    players: typeof body.players === 'number' ? body.players : 1,
    maxPlayers: typeof body.maxPlayers === 'number' ? body.maxPlayers : 4,
    public: isPublic,
    mode: body.mode || 'P2P',
    hostPeerId: body.ownerPeerId || body.hostPeerId || '',
    joinCode: isPublic ? null : body.joinCode || null,
    lastHeartbeat: Date.now()
  };
  rooms.set(roomId, entry);
  broadcastRooms();
  return res.status(201).json({ ok: true });
});

app.post('/rooms/:roomId/heartbeat', (req, res) => {
  const roomId = req.params.roomId;
  const entry = rooms.get(roomId);
  if (!entry) {
    return res.status(404).json({ error: 'Room not found' });
  }
  const players = req.body && typeof req.body.players === 'number' ? req.body.players : entry.players;
  entry.players = players;
  entry.lastHeartbeat = Date.now();
  rooms.set(roomId, entry);
  broadcastRooms();
  return res.json({ ok: true });
});

app.delete('/rooms/:roomId', (req, res) => {
  const roomId = req.params.roomId;
  if (rooms.delete(roomId)) {
    broadcastRooms();
  }
  return res.json({ ok: true });
});

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ rooms: serialiseRooms() }));
});

setInterval(() => {
  const now = Date.now();
  const staleRooms = [];
  rooms.forEach((room, id) => {
    if (now - room.lastHeartbeat > HEARTBEAT_TIMEOUT) {
      staleRooms.push(id);
    }
  });
  if (staleRooms.length > 0) {
    staleRooms.forEach((id) => rooms.delete(id));
    broadcastRooms();
  }
}, CLEANUP_INTERVAL);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
});
