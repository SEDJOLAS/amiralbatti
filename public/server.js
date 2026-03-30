const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════════
// GAME STATE
// ═══════════════════════════════════════════════
const rooms = {}; // roomId -> Room

const SHIPS_DEF = [
  { name: 'Uçak Gemisi', size: 5, count: 1 },
  { name: 'Zırhlı Gemi', size: 4, count: 1 },
  { name: 'Destroyer',   size: 3, count: 2 },
  { name: 'Denizaltı',   size: 2, count: 2 },
];
const GRID = 10;
const TOTAL_SHIP_CELLS = SHIPS_DEF.reduce((s, d) => s + d.size * d.count, 0);

function createRoom(roomId, hostName, maxPlayers) {
  return {
    id: roomId,
    maxPlayers,
    phase: 'lobby',    // lobby | placement | game | result
    players: [],       // { id, name, color, grid, ships, shipCells, hits, alive, ready }
    currentTurn: 0,
    createdAt: Date.now(),
  };
}

const COLORS = ['#00e5ff', '#00e676', '#ff6d00', '#d500f9'];

function createPlayer(socketId, name, colorIdx) {
  return {
    id: socketId,
    name,
    color: COLORS[colorIdx],
    colorIdx,
    grid: Array.from({ length: GRID }, () => Array(GRID).fill(0)),
    ships: [],
    shipCells: new Set(),
    hits: 0,
    alive: true,
    ready: false,
  };
}

function getShipCells(r, c, size, orientation) {
  const cells = [];
  for (let i = 0; i < size; i++) {
    if (orientation === 'h') cells.push([r, c + i]);
    else cells.push([r + i, c]);
  }
  return cells;
}

function isValidPlacement(grid, cells) {
  for (const [r, c] of cells) {
    if (r < 0 || r >= GRID || c < 0 || c >= GRID) return false;
    if (grid[r][c] !== 0) return false;
  }
  return true;
}

function randomPlacement(player) {
  player.grid = Array.from({ length: GRID }, () => Array(GRID).fill(0));
  player.ships = [];
  player.shipCells = new Set();

  const queue = [];
  SHIPS_DEF.forEach(def => {
    for (let i = 0; i < def.count; i++) queue.push(def);
  });

  queue.forEach(ship => {
    let placed = false, tries = 0;
    while (!placed && tries < 1000) {
      tries++;
      const ori = Math.random() < 0.5 ? 'h' : 'v';
      const r = Math.floor(Math.random() * GRID);
      const c = Math.floor(Math.random() * GRID);
      const cells = getShipCells(r, c, ship.size, ori);
      if (isValidPlacement(player.grid, cells)) {
        cells.forEach(([sr, sc]) => {
          player.grid[sr][sc] = 1;
          player.shipCells.add(`${sr},${sc}`);
        });
        player.ships.push({ cells, sunk: false });
        placed = true;
      }
    }
  });
}

function getPublicRoom(room) {
  return {
    id: room.id,
    maxPlayers: room.maxPlayers,
    phase: room.phase,
    currentTurn: room.currentTurn,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      colorIdx: p.colorIdx,
      hits: p.hits,
      alive: p.alive,
      ready: p.ready,
    })),
  };
}

// ═══════════════════════════════════════════════
// SOCKET HANDLERS
// ═══════════════════════════════════════════════
io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // Create room
  socket.on('createRoom', ({ name, maxPlayers }) => {
    const roomId = Math.random().toString(36).substr(2, 6).toUpperCase();
    const room = createRoom(roomId, name, maxPlayers);
    const player = createPlayer(socket.id, name, 0);
    room.players.push(player);
    rooms[roomId] = room;
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.playerId = socket.id;
    socket.emit('roomCreated', { roomId, room: getPublicRoom(room), yourId: socket.id });
    console.log(`Room ${roomId} created by ${name}`);
  });

  // Join room
  socket.on('joinRoom', ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit('error', 'Oda bulunamadı.');
    if (room.phase !== 'lobby') return socket.emit('error', 'Oyun zaten başladı.');
    if (room.players.length >= room.maxPlayers) return socket.emit('error', 'Oda dolu.');
    if (room.players.find(p => p.id === socket.id)) return socket.emit('error', 'Zaten odadasın.');

    const colorIdx = room.players.length;
    const player = createPlayer(socket.id, name, colorIdx);
    room.players.push(player);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.playerId = socket.id;

    io.to(roomId).emit('roomUpdated', getPublicRoom(room));
    socket.emit('joinedRoom', { roomId, room: getPublicRoom(room), yourId: socket.id });
    console.log(`${name} joined room ${roomId}`);
  });

  // Start game (host only)
  socket.on('startGame', () => {
    const room = rooms[socket.data.roomId];
    if (!room) return;
    if (room.players[0].id !== socket.id) return socket.emit('error', 'Sadece host başlatabilir.');
    if (room.players.length < 2) return socket.emit('error', 'En az 2 oyuncu gerekli.');
    room.phase = 'placement';
    io.to(room.id).emit('gameStarted', getPublicRoom(room));
  });

  // Place ships
  socket.on('placeShips', ({ ships }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'placement') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    // Validate & apply
    const grid = Array.from({ length: GRID }, () => Array(GRID).fill(0));
    const shipCells = new Set();
    const builtShips = [];
    let valid = true;

    for (const s of ships) {
      const cells = getShipCells(s.r, s.c, s.size, s.orientation);
      if (!isValidPlacement(grid, cells)) { valid = false; break; }
      cells.forEach(([r, c]) => { grid[r][c] = 1; shipCells.add(`${r},${c}`); });
      builtShips.push({ cells, sunk: false });
    }

    if (!valid) return socket.emit('error', 'Geçersiz gemi yerleşimi.');

    player.grid = grid;
    player.ships = builtShips;
    player.shipCells = shipCells;
    player.ready = true;

    io.to(room.id).emit('playerReady', { playerId: socket.id, room: getPublicRoom(room) });

    // Check if all ready
    if (room.players.every(p => p.ready)) {
      room.phase = 'game';
      room.currentTurn = 0;
      io.to(room.id).emit('allReady', getPublicRoom(room));
    }
  });

  // Random placement request
  socket.on('randomPlacement', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'placement') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    randomPlacement(player);
    player.ready = true;

    io.to(room.id).emit('playerReady', { playerId: socket.id, room: getPublicRoom(room) });

    if (room.players.every(p => p.ready)) {
      room.phase = 'game';
      room.currentTurn = 0;
      io.to(room.id).emit('allReady', getPublicRoom(room));
    }
  });

  // Shoot
  socket.on('shoot', ({ targetId, r, c }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'game') return;

    const currentPlayer = room.players[room.currentTurn];
    if (currentPlayer.id !== socket.id) return socket.emit('error', 'Sıra sende değil.');

    const target = room.players.find(p => p.id === targetId);
    if (!target || !target.alive) return socket.emit('error', 'Geçersiz hedef.');
    if (target.grid[r][c] === 2 || target.grid[r][c] === 3) return socket.emit('error', 'Bu hücreye zaten ateş edildi.');

    const isHit = target.grid[r][c] === 1;
    target.grid[r][c] = isHit ? 2 : 3;

    let sunkShip = null;
    let playerEliminated = false;
    let gameOver = false;
    let winner = null;

    if (isHit) {
      currentPlayer.hits++;
      const ship = target.ships.find(s => !s.sunk && s.cells.every(([sr, sc]) => target.grid[sr][sc] === 2));
      if (ship) {
        ship.sunk = true;
        sunkShip = ship;
      }
      if (target.ships.every(s => s.sunk)) {
        target.alive = false;
        playerEliminated = true;
        const alivePlayers = room.players.filter(p => p.alive);
        if (alivePlayers.length === 1) {
          gameOver = true;
          winner = alivePlayers[0];
          room.phase = 'result';
        }
      }
    }

    // Advance turn if miss or eliminated
    if (!gameOver) {
      if (!isHit || playerEliminated) {
        let next = (room.currentTurn + 1) % room.players.length;
        let tries = 0;
        while (!room.players[next].alive && tries < room.players.length) {
          next = (next + 1) % room.players.length;
          tries++;
        }
        room.currentTurn = next;
      }
    }

    // Send masked grids to everyone
    const maskedStates = room.players.map(p => ({
      id: p.id,
      grid: p.grid.map((row, ri) => row.map((cell, ci) => {
        // Hide enemy ships
        if (cell === 1) return 0;
        return cell;
      })),
      ownGrid: p.grid, // only sent to the owner
    }));

    io.to(room.id).emit('shootResult', {
      attackerId: socket.id,
      targetId,
      r, c,
      isHit,
      sunkShip: sunkShip ? true : false,
      playerEliminated,
      eliminatedId: playerEliminated ? targetId : null,
      gameOver,
      winnerId: winner ? winner.id : null,
      room: getPublicRoom(room),
      // Each player's masked grid
      grids: room.players.map(p => ({
        id: p.id,
        // Hide ships (val=1 -> 0) for others, show for owner
        maskedGrid: p.grid.map(row => row.map(cell => cell === 1 ? 0 : cell)),
        ownGrid: p.grid,
        ships: p.ships,
      })),
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) {
      delete rooms[roomId];
      console.log(`Room ${roomId} deleted`);
    } else {
      io.to(roomId).emit('playerLeft', { playerId: socket.id, room: getPublicRoom(room) });
      // If game was running and only 1 alive, end it
      if (room.phase === 'game') {
        const alive = room.players.filter(p => p.alive);
        if (alive.length === 1) {
          room.phase = 'result';
          io.to(roomId).emit('gameOver', { winnerId: alive[0].id, room: getPublicRoom(room) });
        }
      }
    }
    console.log(`Disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚢 Amiral Battı server running on port ${PORT}`);
});
