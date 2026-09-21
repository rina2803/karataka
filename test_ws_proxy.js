// Test définitif : handshake polling PUIS upgrade WebSocket avec le vrai sid
const https = require('https');
const WebSocket = require('ws');

function httpGet(path) {
  return new Promise((resolve, reject) => {
    https.get({ host: 'lalaosykarataka.infinity.mg', path, timeout: 12000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject).on('timeout', () => { reject(new Error('timeout')); });
  });
}

(async () => {
  // Étape 1 : handshake polling
  const hs = await httpGet('/socket.io/?EIO=4&transport=polling');
  console.log('HANDSHAKE:', hs.status, hs.body.slice(0, 140));
  const sid = JSON.parse(hs.body.slice(1)).sid;

  // Étape 2 : upgrade WebSocket avec le vrai sid (ce que fait le client socket.io)
  await new Promise((resolve) => {
    const ws = new WebSocket(
      `wss://lalaosykarataka.infinity.mg/socket.io/?EIO=4&transport=websocket&sid=${sid}`,
      { handshakeTimeout: 12000 }
    );
    ws.on('open', () => console.log('UPGRADE AVEC SID: OPEN ✅'));
    ws.on('message', (m) => {
      console.log('MESSAGE:', m.toString().slice(0, 80));
      try { ws.close(); } catch (_) {}
      resolve();
    });
    ws.on('unexpected-response', (_r, res) => {
      console.log('UPGRADE AVEC SID: HTTP', res.statusCode, '❌');
      resolve();
    });
    ws.on('error', (e) => { console.log('UPGRADE ERROR:', e.message); resolve(); });
  });
  process.exit(0);
})().catch((e) => { console.log('FATAL:', e.message); process.exit(1); });

