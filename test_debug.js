// Test node → server with UTF-8
const http = require('http');

const data = JSON.stringify({name: '测试用户', pass: '1234'});
console.log('Sending data:', data);
console.log('Data hex:', Buffer.from(data).toString('hex'));

const req = http.request({
  hostname: 'localhost',
  port: 3789,
  path: '/api/register',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
  }
}, res => {
  console.log('status:', res.statusCode);
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    console.log('Response body:', body);
    try {
      const j = JSON.parse(body);
      if (j.state && j.state.me) {
        console.log('Stored name hex:', Buffer.from(j.state.me.name).toString('hex'));
        console.log('Stored name:', j.state.me.name);
      }
    } catch (e) { /* not json */ }
  });
});
req.on('error', e => console.error('err:', e));
req.write(data);
req.end();