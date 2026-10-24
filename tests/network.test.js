import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHardwarePorts, listConnections, formatConnections } from '../server/network.js';

const ipv4 = address => ({ address, family: 'IPv4', internal: false });

test('macOS hardware names identify Ethernet even when Wi-Fi uses en0', () => {
  const ports = parseHardwarePorts('Hardware Port: Wi-Fi\nDevice: en0\nEthernet Address: aa:bb\n\nHardware Port: USB 10/100/1000 LAN\nDevice: en7\n\nHardware Port: Ethernet\nDevice: en1\n');
  const connections = listConnections({ en0: [ipv4('10.0.0.2')], en7: [ipv4('192.168.2.3')], en1: [ipv4('192.168.1.4')] }, ports);
  assert.deepEqual(connections.map(({ device, kind }) => [device, kind]), [['en7', 'ethernet'], ['en1', 'ethernet'], ['en0', 'wifi']]);
});

test('connection list excludes loopback and IPv6 and keeps direct-cable IPv4 addresses', () => {
  const connections = listConnections({ lo0: [{ ...ipv4('127.0.0.1'), internal: true }], en0: [{ address: 'fe80::1', family: 'IPv6', internal: false }], eth0: [ipv4('169.254.10.2')], utun0: [ipv4('10.1.1.2')] });
  assert.deepEqual(connections.map(({ address, kind }) => [address, kind]), [['169.254.10.2', 'ethernet'], ['10.1.1.2', 'vpn']]);
  assert.equal(listConnections({ en0: [ipv4('192.168.1.2')] })[0].kind, 'network', 'Do not guess macOS en0 is wired when hardware lookup fails');
});

test('startup URLs distinguish local access from Ethernet and use the actual server ports', () => {
  const text = formatConnections(listConnections({ enp3s0: [ipv4('192.168.10.5')] }), 5190, 5191);
  assert.match(text, /Ethernet \[enp3s0\].*有線LAN/);
  assert.match(text, /http:\/\/localhost:5190\//);
  assert.match(text, /iPad \/ 編集: +http:\/\/192\.168\.10\.5:5190\//);
  assert.match(text, /Web Render TOP: http:\/\/192\.168\.10\.5:5191\/output/);
  assert.doesNotMatch(text, /見つかりません/);
});

test('startup explains when no Ethernet IPv4 address is currently available', () => {
  const text = formatConnections([], 5180, 5181);
  assert.match(text, /EthernetのIPv4アドレスは現在見つかりません/);
  assert.match(text, /npm run dev を再起動/);
});
