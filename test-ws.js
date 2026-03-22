import WebSocket from 'ws';

const ws = new WebSocket('wss://ais-pre-dt4nqv275ftc6hw74dddp2-167497036422.europe-west3.run.app');

ws.on('open', function open() {
  console.log('connected');
  ws.send(JSON.stringify({ type: 'ping' }));
});

ws.on('message', function incoming(data) {
  console.log('received: %s', data);
});

ws.on('error', function error(err) {
  console.error('error:', err);
});

ws.on('close', function close() {
  console.log('disconnected');
});
