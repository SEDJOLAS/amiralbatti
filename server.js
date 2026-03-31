const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  // Railway için: önce polling, sonra websocket'e yükselt
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Railway health check endpoint
app.get('/health', (req, res) => res.json({ status: 'ok', rooms: Object.keys(rooms).length }));

app.use(express.static(path.join(__dirname, 'public')));

// ── GAME STATE ──────────────────────────────────────────────
// rooms: { [roomCode]: Room }
const rooms = {};

const SHIPS_CONFIG = [
  { name: 'Uçak Gemisi', size: 5, count: 1 },
  { name: 'Zırhlı',      size: 4, count: 1 },
  { name: 'Kruvazör',    size: 3, count: 2 },
  { name: 'Destroyer',   size: 2, count: 3 },
];
const MAX_PLAYERS = 4;
const TOTAL_SHIP_CELLS = SHIPS_CONFIG.reduce((a, s) => a + s.size * s.count, 0); // 5+4+3+3+2+2+2 = 21

function createRoom(code) {
  return {
    code,
    players: [],      // [{ id, name, board, ships, hits, shots, ready, alive }]
    phase: 'lobby',   // lobby | placement | game | finished
    turnIndex: 0,     // index into alive players
    log: [],
  };
}

function createEmptyBoard() {
  return Array(10).fill(null).map(() => Array(10).fill(0));
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

function getAlivePlayers(room) {
  return room.players.filter(p => p.alive);
}

function getCurrentTurnPlayer(room) {
  const alive = getAlivePlayers(room);
  if (!alive.length) return null;
  return alive[room.turnIndex % alive.length];
}

function advanceTurn(room) {
  const alive = getAlivePlayers(room);
  room.turnIndex = (room.turnIndex + 1) % alive.length;
}

function broadcastRoom(room) {
  // Send safe state to each player (hide other boards)
  room.players.forEach(player => {
    const safeState = buildSafeState(room, player.id);
    io.to(player.id).emit('room_update', safeState);
  });
}

function buildSafeState(room, playerId) {
  return {
    code: room.code,
    phase: room.phase,
    turnPlayerId: getCurrentTurnPlayer(room)?.id || null,
    log: room.log.slice(-20),
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
      alive: p.alive,
      hits: p.hits,
      shots: p.shots,
      shipCount: p.ships.length,
      sunkCount: p.ships.filter(s => s.sunk).length,
      // Own board with ships visible; others' boards hidden (only hits/misses)
      board: p.id === playerId
        ? p.board
        : p.board.map(row => row.map(v => (v === 1 ? 0 : v))), // hide ships
    })),
    myId: playerId,
  };
}

// ── SOCKET EVENTS ───────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('connect:', socket.id);

  // CREATE ROOM
  socket.on('create_room', ({ name }) => {
    let code;
    do { code = genCode(); } while (rooms[code]);
    const room = createRoom(code);
    rooms[code] = room;
    joinRoom(socket, room, name);
  });

  // JOIN ROOM
  socket.on('join_room', ({ code, name }) => {
    const room = rooms[code.toUpperCase()];
    if (!room) { socket.emit('error', 'Oda bulunamadı.'); return; }
    if (room.phase !== 'lobby') { socket.emit('error', 'Oyun zaten başladı.'); return; }
    if (room.players.length >= MAX_PLAYERS) { socket.emit('error', 'Oda dolu (max 4 oyuncu).'); return; }
    joinRoom(socket, room, name);
  });

  function joinRoom(socket, room, name) {
    socket.join(room.code);
    room.players.push({
      id: socket.id,
      name: name || `Oyuncu ${room.players.length + 1}`,
      board: createEmptyBoard(),
      ships: [],
      hits: 0,
      shots: 0,
      ready: false,
      alive: true,
    });
    socket.emit('joined', { code: room.code, playerId: socket.id });
    addLog(room, `⚓ ${name} odaya katıldı.`);
    broadcastRoom(room);
  }

  // SUBMIT PLACEMENT
  socket.on('submit_placement', ({ code, board, ships }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'placement') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    player.board = board;
    player.ships = ships.map(s => ({ ...s, sunk: false }));
    player.ready = true;
    addLog(room, `✅ ${player.name} hazır.`);

    // All ready → start game
    if (room.players.every(p => p.ready)) {
      room.phase = 'game';
      room.turnIndex = 0;
      addLog(room, '🚀 Savaş başladı!');
    }
    broadcastRoom(room);
  });

  // START PLACEMENT (host triggers)
  socket.on('start_placement', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    if (room.players[0].id !== socket.id) { socket.emit('error', 'Sadece oda sahibi başlatabilir.'); return; }
    if (room.players.length < 2) { socket.emit('error', 'En az 2 oyuncu gerekli.'); return; }
    room.phase = 'placement';
    addLog(room, '🗺 Gemi yerleştirme başladı!');
    broadcastRoom(room);
  });

  // SHOOT
  socket.on('shoot', ({ code, targetId, row, col }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'game') return;
    const shooter = room.players.find(p => p.id === socket.id);
    const target  = room.players.find(p => p.id === targetId);
    if (!shooter || !target) return;
    if (shooter.id !== getCurrentTurnPlayer(room)?.id) { socket.emit('error', 'Sıra sende değil!'); return; }
    if (!target.alive) { socket.emit('error', 'Bu oyuncu zaten elendi.'); return; }
    if (shooter.id === target.id) { socket.emit('error', 'Kendine atamazsın!'); return; }

    const board = target.board;
    if ([2, 3, 4].includes(board[row][col])) { socket.emit('error', 'Bu hücreye zaten atıldı.'); return; }

    shooter.shots++;
    let result = 'miss';

    if (board[row][col] === 1) {
      board[row][col] = 2; // hit
      shooter.hits++;
      result = 'hit';

      // Check sunk
      for (const ship of target.ships) {
        if (!ship.sunk && ship.cells.some(([r, c]) => r === row && c === col)) {
          if (ship.cells.every(([r, c]) => board[r][c] === 2)) {
            ship.sunk = true;
            ship.cells.forEach(([r, c]) => board[r][c] = 4);
            result = 'sunk';
            addLog(room, `💥 ${shooter.name} → ${target.name}: ${ship.name} BATTI!`);
          }
          break;
        }
      }
      if (result === 'hit') addLog(room, `🎯 ${shooter.name} → ${target.name}: İSABET!`);

      // Check if target eliminated
      if (target.ships.every(s => s.sunk)) {
        target.alive = false;
        addLog(room, `☠️ ${target.name} elendi!`);

        // Check win
        const alive = getAlivePlayers(room);
        if (alive.length === 1) {
          room.phase = 'finished';
          addLog(room, `🏆 ${alive[0].name} KAZANDI!`);
          broadcastRoom(room);
          return;
        }
      }
    } else {
      board[row][col] = 3; // miss
      addLog(room, `💧 ${shooter.name} → ${target.name}: ISKA!`);
    }

    // Advance turn on miss
    if (result === 'miss') advanceTurn(room);

    broadcastRoom(room);
  });

  // DISCONNECT
  socket.on('disconnect', () => {
    for (const code of Object.keys(rooms)) {
      const room = rooms[code];
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        const name = room.players[idx].name;
        room.players.splice(idx, 1);
        addLog(room, `🔌 ${name} ayrıldı.`);
        if (room.players.length === 0) {
          delete rooms[code];
        } else {
          // If was current turn player, advance
          const alive = getAlivePlayers(room);
          if (alive.length > 0) room.turnIndex = room.turnIndex % alive.length;
          // Check win condition
          if (room.phase === 'game' && alive.length === 1) {
            room.phase = 'finished';
            addLog(room, `🏆 ${alive[0].name} KAZANDI! (oyuncular ayrıldı)`);
          }
          broadcastRoom(room);
        }
        break;
      }
    }
  });
});

function addLog(room, msg) {
  room.log.push(msg);
  if (room.log.length > 50) room.log.shift();
}

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`✅ Sunucu calisiyor: ${HOST}:${PORT}`);
});
server.on('error', (err) => { console.error('Sunucu hatasi:', err); process.exit(1); });
