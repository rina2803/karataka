/**
 * Test de reproduction : connexion socket.io + création de salle
 * Simule exactement ce que fait l'app Flutter.
 */
const { io } = require('socket.io-client');

const BASE = process.env.BASE_URL || 'https://lalaosykarataka.infinity.mg';
const TRANSPORTS = (process.env.TRANSPORTS || 'polling').split(',');

async function login() {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'seed@lalao.test', password: 'Password123' }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error(`Login failed: ${res.status} ${JSON.stringify(data)}`);
  console.log('✅ Login OK, token length =', data.token.length);
  return data.token;
}

async function main() {
  const token = await login();

  console.log(`🔌 Connecting to ${BASE} with transports=[${TRANSPORTS}] ...`);
  const socket = io(BASE, {
    transports: TRANSPORTS,
    upgrade: TRANSPORTS.includes('websocket') === false,
    auth: { token },
    query: { token },
    reconnection: false,
    timeout: 15000,
  });

  const done = (code) => { try { process.exit(code); } catch (_) {} };

  socket.on('connect', () => {
    console.log('✅ SOCKET CONNECTED id=', socket.id, 'transport=', socket.io.engine.transport.name);

    // 1) Test chess:create-room
    console.log('🎲 Emitting chess:create-room ...');
    socket.timeout(15000).emit(
      'chess:create-room',
      { stake: 0, timeControlMinutes: 0 },
      (err, res) => {
        if (err) {
          console.error('❌ create-room ACK TIMEOUT:', err.message);
          done(1);
          return;
        }
        console.log('📥 create-room response:', JSON.stringify(res));
        if (res && res.error) {
          console.error('❌ create-room returned error:', res.error);
          done(2);
          return;
        }
        console.log('✅ CREATE ROOM WORKS');
        socket.disconnect();
        done(0);
      },
    );
  });

  socket.on('connect_error', (e) => {
    console.error('⚠️ connect_error:', e.message);
  });

  setTimeout(() => {
    console.error('⏱️ Global test timeout (30s)');
    socket.disconnect();
    done(3);
  }, 30000);
}

main().catch((e) => {
  console.error('❌ FATAL:', e.message);
  process.exit(1);
});
