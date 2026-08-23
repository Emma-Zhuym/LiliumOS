import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });
const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);

rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === 'initialize') {
    return reply(message.id, {
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'mock-apple-events', version: '0.1.0' },
    });
  }
  if (message.method === 'tools/list') {
    return reply(message.id, {
      tools: [{ name: 'calendar_calendars', description: 'Mock calendars', inputSchema: { type: 'object' } }],
    });
  }
  if (message.method === 'tools/call') {
    return reply(message.id, { content: [{ type: 'text', text: `called:${message.params?.name}` }] });
  }
  process.stdout.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: message.id,
    error: { code: -32601, message: 'Method not found' },
  })}\n`);
});
