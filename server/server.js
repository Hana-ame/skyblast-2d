/**
 * SkyBlast 2D - 轻量级搜索/等待大厅与聊天 API Server（自 SkyBlast v2 带入，零依赖）
 *
 * 职责说明：
 * 1. PeerJS WebRTC 信令中继使用官方 `0.peerjs.com`（可换自建 peerjs-server）
 * 2. 本 Server 仅提供纯 HTTP JSON API，负责：
 *    - 房间注册与等待列表同步 (传递 Host 的 PeerJS 配对 ID)
 *    - 自动快速匹配搜索 (将等待中的玩家配对至可用房间 Host PeerJS ID)
 *    - 待机大厅与房间内的实时文字聊天广播
 * 
 * 启动方式：
 *   node server.js
 * 默认监听端口：3000 (可通过 PORT 环境变量修改)
 */

const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 3000;

// 内存状态存储
const rooms = new Map(); // roomId -> { roomId, roomName, hostPeerId, hostName, teamCounts, playerCount, maxPlayers, status, updatedAt }
const waitingQueue = new Map(); // peerId -> { peerId, name, team, preferredRoomHostId, updatedAt }
const chatMessages = []; // [{ id, sender, team, text, roomId, timestamp }]
const MAX_CHAT_HISTORY = 100;
const ROOM_TTL_MS = 35000; // 35秒无心跳自动清理

function cleanupStaleEntries() {
  const now = Date.now();
  for (const [id, room] of rooms.entries()) {
    if (now - room.updatedAt > ROOM_TTL_MS) {
      rooms.delete(id);
    }
  }
  for (const [peerId, waiter] of waitingQueue.entries()) {
    if (now - waiter.updatedAt > ROOM_TTL_MS) {
      waitingQueue.delete(peerId);
    }
  }
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 1e5) {
        req.destroy();
        finish({});
      }
    });
    req.on('end', () => {
      try {
        finish(body ? JSON.parse(body) : {});
      } catch (e) {
        finish({});
      }
    });
    req.on('error', () => finish({}));
    req.on('close', () => finish({}));
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  cleanupStaleEntries();
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 1. 获取大厅状态 (房间列表 + 等待人数 + 最新聊天消息)
  if (req.method === 'GET' && pathname === '/api/lobby') {
    const roomIdFilter = parsedUrl.query.roomId || 'global';
    const since = Number(parsedUrl.query.since || 0);
    const filteredChat = chatMessages.filter(
      (m) => (m.roomId === 'global' || m.roomId === roomIdFilter) && m.timestamp >= since
    );
    return sendJson(res, 200, {
      ok: true,
      peerRelay: '0.peerjs.com',
      rooms: Array.from(rooms.values()),
      waitingCount: waitingQueue.size,
      waitingPlayers: Array.from(waitingQueue.values()).map((w) => ({
        peerId: w.peerId,
        name: w.name,
        team: w.team
      })),
      messages: filteredChat.slice(-50),
      serverTime: Date.now()
    });
  }

  // 2. 注册/更新等待中的房间 (仅传递 Host 的 PeerJS ID)
  if (req.method === 'POST' && pathname === '/api/rooms') {
    const body = await parseBody(req);
    const { roomId, roomName, hostPeerId, hostName, playerCount, maxPlayers, status } = body;
    if (!hostPeerId) {
      return sendJson(res, 400, { ok: false, error: 'Missing hostPeerId' });
    }
    const id = roomId || hostPeerId;
    rooms.set(id, {
      roomId: id,
      roomName: (roomName || `${hostName || 'Player'} 的对战房间`).slice(0, 40),
      hostPeerId: String(hostPeerId),
      hostName: String(hostName || 'Host').slice(0, 24),
      playerCount: Number(playerCount || 1),
      maxPlayers: Number(maxPlayers || 100),
      status: status || 'waiting',
      updatedAt: Date.now()
    });
    return sendJson(res, 200, { ok: true, room: rooms.get(id) });
  }

  // 3. 搜索与快速匹配等待 API (寻找可用房间的 hostPeerId，或将等待中的两名玩家直接配对)
  if (req.method === 'POST' && pathname === '/api/search') {
    const body = await parseBody(req);
    const { peerId, name, team } = body;
    if (!peerId) {
      return sendJson(res, 400, { ok: false, error: 'Missing peerId' });
    }

    // 优先查找未满的已创建房间
    const availableRooms = Array.from(rooms.values()).filter(
      (r) => r.hostPeerId !== peerId && r.playerCount < r.maxPlayers
    );

    if (availableRooms.length > 0) {
      const targetRoom = availableRooms[0];
      waitingQueue.delete(peerId);
      return sendJson(res, 200, {
        ok: true,
        matched: true,
        role: 'client',
        hostPeerId: targetRoom.hostPeerId,
        roomId: targetRoom.roomId,
        roomName: targetRoom.roomName
      });
    }

    // 其次检查等待队列中是否有其他正在等待配对的玩家
    for (const [otherPeerId, otherPlayer] of waitingQueue.entries()) {
      if (otherPeerId !== peerId) {
        // 将先进队列的玩家作为 Host，自动创建房间并返回其 PeerJS ID
        const autoRoomId = otherPeerId;
        rooms.set(autoRoomId, {
          roomId: autoRoomId,
          roomName: `${otherPlayer.name} 的自动配对房`,
          hostPeerId: otherPeerId,
          hostName: otherPlayer.name,
          playerCount: 2,
          maxPlayers: 100,
          status: 'waiting',
          updatedAt: Date.now()
        });
        waitingQueue.delete(otherPeerId);
        waitingQueue.delete(peerId);
        return sendJson(res, 200, {
          ok: true,
          matched: true,
          role: 'client',
          hostPeerId: otherPeerId,
          roomId: autoRoomId,
          roomName: `${otherPlayer.name} 的自动配对房`
        });
      }
    }

    // 如果暂时无人可配对，加入等待队列并同时注册为可被搜索的待机宿主
    waitingQueue.set(peerId, {
      peerId: String(peerId),
      name: String(name || 'Player').slice(0, 24),
      team: String(team || 'red'),
      updatedAt: Date.now()
    });

    return sendJson(res, 200, {
      ok: true,
      matched: false,
      role: 'waiting_host',
      hostPeerId: peerId,
      waitingCount: waitingQueue.size
    });
  }

  // 4. 发送聊天消息 API
  if (req.method === 'POST' && pathname === '/api/chat') {
    const body = await parseBody(req);
    const { sender, team, text, roomId } = body;
    if (!text || !String(text).trim()) {
      return sendJson(res, 400, { ok: false, error: 'Empty message' });
    }
    const msg = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sender: String(sender || '匿名特工').slice(0, 24),
      team: String(team || 'red'),
      text: String(text).trim().slice(0, 240),
      roomId: String(roomId || 'global'),
      timestamp: Date.now()
    };
    chatMessages.push(msg);
    if (chatMessages.length > MAX_CHAT_HISTORY) {
      chatMessages.shift();
    }
    return sendJson(res, 200, { ok: true, message: msg });
  }

  // 5. 离开房间/取消等待 API
  if (req.method === 'POST' && pathname === '/api/leave') {
    const body = await parseBody(req);
    const { peerId, roomId } = body;
    if (peerId) {
      waitingQueue.delete(peerId);
      rooms.delete(peerId);
    }
    if (roomId) {
      rooms.delete(roomId);
    }
    return sendJson(res, 200, { ok: true });
  }

  sendJson(res, 404, {
    ok: false,
    error: 'API endpoint not found. Available endpoints: GET /api/lobby, POST /api/rooms, POST /api/search, POST /api/chat, POST /api/leave'
  });
});

server.listen(PORT, () => {
  console.log(`[PeerJS Arena API Server] Running at http://localhost:${PORT}`);
  console.log(`[PeerJS Relay] Fixed to 0.peerjs.com`);
  console.log(`[Endpoints] GET /api/lobby | POST /api/rooms | POST /api/search | POST /api/chat | POST /api/leave`);
});
