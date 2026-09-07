// 端到端测试脚本 - 用纯 Node HTTP（避免 bash/curl 编码问题）
const http = require('http');

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost', port: 3789, path, method,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      }
    };
    const r = http.request(opts, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch (e) { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const tests = [];
const T = (name, fn) => tests.push({ name, fn });

T('1. Setup admin (小雪老师)', async () => {
  const r = await req('POST', '/api/setup', { name: '小雪老师', pass: '1234' });
  return r;
});
T('2. Login wrong password', async () => {
  return req('POST', '/api/login', { name: '小雪老师', pass: 'wrong' });
});

(async () => {
  let token, itemId, reqId, userId, normToken;
  for (const t of tests) {
    const r = await t.fn();
    console.log(`=== ${t.name} ===`);
    console.log('  status:', r.status);
    console.log('  body:', JSON.stringify(r.body).slice(0, 200));
    if (t.name.startsWith('1.')) token = r.body.token;
    await new Promise(r => setTimeout(r, 100));
  }

  // Continue with token
  T('3. Login correct', async () => {
    const r = await req('POST', '/api/login', { name: '小雪老师', pass: '1234' });
    token = r.body.token;
    return r;
  });
  T('4. Add item 双面胶', async () => {
    return req('POST', '/api/items', { action: 'add', name: '双面胶', spec: '宽4cm', category: '胶类', unit: '卷', initQty: 50, minQty: 10 }, token);
  });
  T('5. Get state (extract item id)', async () => {
    const r = await req('GET', '/api/state', null, token);
    itemId = r.body.state.items[0]?.id;
    return r;
  });
  T('6. Inbound +20', async () => {
    return req('POST', '/api/inbound', { itemId, qty: 20, remark: '淘宝购入' }, token);
  });
  T('7. Register 王老师 (normal)', async () => {
    const r = await req('POST', '/api/register', { name: '王老师', pass: '5678' });
    normToken = r.body.token;
    return r;
  });
  T('8. Normal inbound → 403', async () => {
    return req('POST', '/api/inbound', { itemId, qty: 5 }, normToken);
  });
  T('9. Normal submits out request (qty 3)', async () => {
    const r = await req('POST', '/api/req', { type: 'out', itemId, qty: 3, reason: '小班上课' }, normToken);
    // Get request id
    const st = await req('GET', '/api/state', null, token);
    reqId = st.body.state.requests.find(x => x.type === 'out' && x.status === 'pending')?.id;
    return r;
  });
  T('10. Admin approves', async () => {
    return req('POST', '/api/approve', { id: reqId, action: 'approve' }, token);
  });
  T('11. Verify qty = 67', async () => {
    const r = await req('GET', '/api/state', null, token);
    const it = r.body.state.items[0];
    const ok = it.qty === 67;
    return { status: ok ? 200 : 500, body: { qty: it.qty, name: it.name, expected: 67, ok } };
  });
  T('12. Buy request', async () => {
    return req('POST', '/api/buy', { itemName: '彩色卡纸', spec: 'A4', unit: '包', qty: 10, reason: '不够用了' }, normToken);
  });
  T('13. Admin promotes 王老师', async () => {
    const st = await req('GET', '/api/state', null, token);
    userId = st.body.state.users.find(u => u.name === '王老师')?.id;
    return req('POST', '/api/users', { action: 'role', userId, role: 'authorized' }, token);
  });
  T('14. Backup', async () => {
    const r = await req('GET', '/api/backup', null, token);
    return { status: r.status, body: { size: JSON.stringify(r.body).length, users: r.body.users.length, items: r.body.items.length, requests: r.body.requests.length, logs: r.body.logs.length } };
  });
  T('15. Diag', async () => {
    return req('GET', '/api/diag', null, token);
  });
  T('16. Change password', async () => {
    return req('POST', '/api/changepass', { oldPass: '1234', newPass: 'abcd' }, token);
  });
  T('17. Login with new password', async () => {
    return req('POST', '/api/login', { name: '小雪老师', pass: 'abcd' });
  });
  T('18. No token → 401', async () => {
    return req('GET', '/api/state');
  });
  T('19. Logout', async () => {
    return req('POST', '/api/logout', {}, token);
  });

  // Re-run remaining tests
  for (const t of tests.slice(3)) { // skip first 3 already done
    const r = await t.fn();
    const status = r.status >= 200 && r.status < 300 ? '✓' : '✗';
    console.log(`${status} [${r.status}] ${t.name}`);
    if (r.status >= 400) console.log('   body:', JSON.stringify(r.body).slice(0, 200));
    else if (typeof r.body === 'object') console.log('   ', JSON.stringify(r.body).slice(0, 150));
    await new Promise(r => setTimeout(r, 50));
  }

  console.log('\n=== ALL DONE ===');
  process.exit(0);
})();