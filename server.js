const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 클라우드타입 포트 설정 준수
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // 주소 접속 시 index.html 파일을 읽어서 보내줌
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error: index.html not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } 
  // 헬스체크용 API
  else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', rooms: rooms.size, timestamp: Date.now() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();

function broadcast(room, message, excludeWs = null) {
  const data = JSON.stringify(message);
  for (const [ws] of room.clients) {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function getRoomInfo(room) {
  const players = [];
  for (const [, info] of room.clients) {
    players.push({ id: info.id, name: info.name, color: info.color, pingMs: info.pingMs });
  }
  return { name: room.name, players };
}

wss.on('connection', (ws) => {
  let currentRoom = null;
  const clientId = crypto.randomUUID();
  let clientInfo = { id: clientId, name: 'Musician', color: '#00e5ff', pingMs: 0 };

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'create_room': {
        const roomId = crypto.randomBytes(3).toString('hex').toUpperCase();
        const room = { name: (msg.name || 'New Room').slice(0, 40), password: msg.password || '', clients: new Map(), maxPlayers: Math.min(msg.maxPlayers || 8, 16) };
        rooms.set(roomId, room);
        currentRoom = roomId;
        clientInfo.name = (msg.playerName || 'Host').slice(0, 20);
        clientInfo.color = msg.color || '#00e5ff';
        room.clients.set(ws, clientInfo);
        ws.send(JSON.stringify({ type: 'room_joined', roomId, clientId, roomInfo: getRoomInfo(room) }));
        break;
      }
      case 'join_room': {
        const room = rooms.get(msg.roomId);
        if (!room) { ws.send(JSON.stringify({ type: 'error', message: '방을 찾을 수 없습니다.' })); return; }
        if (room.password && room.password !== msg.password) { ws.send(JSON.stringify({ type: 'error', message: '비밀번호가 틀렸습니다.' })); return; }
        if (room.clients.size >= room.maxPlayers) { ws.send(JSON.stringify({ type: 'error', message: '방이 가득 찼습니다.' })); return; }
        currentRoom = msg.roomId;
        clientInfo.name = (msg.playerName || 'Musician').slice(0, 20);
        clientInfo.color = msg.color || '#ff6b35';
        room.clients.set(ws, clientInfo);
        ws.send(JSON.stringify({ type: 'room_joined', roomId: msg.roomId, clientId, roomInfo: getRoomInfo(room) }));
        broadcast(room, { type: 'player_joined', player: clientInfo, roomInfo: getRoomInfo(room) }, ws);
        break;
      }
      case 'midi': {
        if (!currentRoom) return;
        const room = rooms.get(currentRoom);
        if (room) broadcast(room, { type: 'midi', senderId: clientId, senderName: clientInfo.name, senderColor: clientInfo.color, data: msg.data, serverTime: Date.now() }, ws);
        break;
      }
      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong', clientTime: msg.clientTime, serverTime: Date.now() }));
        break;
      }
      case 'get_rooms': {
        const list = [];
        for (const [id, room] of rooms) list.push({ id, name: room.name, players: room.clients.size, maxPlayers: room.maxPlayers, hasPassword: !!room.password });
        ws.send(JSON.stringify({ type: 'room_list', rooms: list }));
        break;
      }
      case 'chat': {
        if (!currentRoom) return;
        const room = rooms.get(currentRoom);
        if (room) broadcast(room, { type: 'chat', senderId: clientId, senderName: clientInfo.name, senderColor: clientInfo.color, message: (msg.message || '').slice(0, 200) }, null);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    room.clients.delete(ws);
    if (room.clients.size === 0) rooms.delete(currentRoom);
    else broadcast(room, { type: 'player_left', playerId: clientId, playerName: clientInfo.name, roomInfo: getRoomInfo(room) });
  });
});

server.listen(PORT, () => console.log(`🎹 Server running on port ${PORT}`));
