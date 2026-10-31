/** 验证凭据加密：磁盘上应该是 enc:v1: 开头，内存里能正常解密 */
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => {
  const i = ++seq;
  return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
};
async function ev(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
  return r.result?.result?.value;
}
await send("Runtime.enable");
await new Promise((r) => setTimeout(r, 800));

const out = await ev(`(async () => {
  const avail = await window.desktop?.cryptoAvailable?.();

  // 磁盘上（localStorage 原始值）
  const raw = localStorage.getItem('3w:credentials');
  let disk = null;
  try {
    const arr = JSON.parse(raw);
    disk = arr.map(c => ({
      label: c.label,
      keyPrefix: (c.apiKey || '').slice(0, 10),
      encrypted: (c.apiKey || '').startsWith('enc:v1:'),
      keyLen: (c.apiKey || '').length,
    }));
  } catch (e) { disk = '解析失败: ' + e.message; }

  // 往返测试
  const probe = 'sk-roundtrip-test-12345';
  const enc = await window.desktop?.cryptoEncrypt?.(probe);
  const dec = enc ? await window.desktop?.cryptoDecrypt?.(enc) : null;

  return {
    cryptoAvailable: avail,
    diskCredentials: disk,
    roundtrip: { encrypted: !!enc, encPrefix: (enc || '').slice(0, 12), decrypted: dec, match: dec === probe },
  };
})()`);

console.log(JSON.stringify(out, null, 2));
ws.close();
