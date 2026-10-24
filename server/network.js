import { networkInterfaces } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export function parseHardwarePorts(text) {
  const ports = new Map();
  let hardwarePort;
  for (const line of text.split(/\r?\n/)) {
    const port = /^Hardware Port:\s*(.+)$/.exec(line.trim());
    const device = /^Device:\s*(.+)$/.exec(line.trim());
    if (port) hardwarePort = port[1];
    else if (device && hardwarePort) { ports.set(device[1], hardwarePort); hardwarePort = undefined; }
  }
  return ports;
}

export function listConnections(interfaces, hardwarePorts = new Map()) {
  return Object.entries(interfaces).flatMap(([device, addresses]) => {
    const hardware = hardwarePorts.get(device);
    // macOS en0/en1 numbering varies by machine. Use its actual hardware names.
    const name = hardware ?? device;
    const kind = /wi-?fi|airport|wireless|^wl/i.test(name) ? 'wifi'
      : /ethernet|^eth\d|^en[opsx]\w|\blan\b/i.test(name) ? 'ethernet'
      : /^(utun|tun|tap|wg|tailscale)/i.test(device) ? 'vpn' : 'network';
    const label = hardware ?? ({ ethernet: 'Ethernet', wifi: 'Wi-Fi', vpn: 'VPN', network: 'Network' })[kind];
    return (addresses ?? []).filter(address => !address.internal && (address.family === 'IPv4' || address.family === 4))
      .map(({ address }) => ({ device, address, kind, label }));
  }).sort((a, b) => ({ ethernet: 0, wifi: 1, network: 2, vpn: 3 })[a.kind] - ({ ethernet: 0, wifi: 1, network: 2, vpn: 3 })[b.kind]);
}

export function formatConnections(connections, editorPort, outputPort) {
  const lines = [
    '',
    '  direct-painting 接続先',
    '',
    '  このPCで開く',
    `    編集画面:       http://localhost:${editorPort}/`,
    `    Web Render TOP: http://localhost:${outputPort}/output`,
  ];
  for (const { label, kind, device, address } of connections) {
    lines.push('', `  ${label} [${device}]${kind === 'ethernet' ? ' ← Ethernet / 有線LAN' : ''}`, `    IP:             ${address}`,
      `    iPad / 編集:    http://${address}:${editorPort}/`,
      `    Web Render TOP: http://${address}:${outputPort}/output`);
  }
  if (!connections.some(connection => connection.kind === 'ethernet')) lines.push('', '  EthernetのIPv4アドレスは現在見つかりません。');
  lines.push('', '  iPadもEthernetでつなぐ場合は、同じ有線LANの「Ethernet」の編集URLを開いてください。',
    '  ケーブル接続やIPが変わった場合は npm run dev を再起動して確認してください。', '');
  return lines.join('\n');
}

export async function connectionInfo(editorPort, outputPort) {
  let hardwarePorts = new Map();
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await exec('/usr/sbin/networksetup', ['-listallhardwareports'], { timeout: 1500, maxBuffer: 64 * 1024 });
      hardwarePorts = parseHardwarePorts(stdout);
    } catch { /* Interface names and IPv4 URLs still work if hardware lookup is unavailable. */ }
  }
  return formatConnections(listConnections(networkInterfaces(), hardwarePorts), editorPort, outputPort);
}
