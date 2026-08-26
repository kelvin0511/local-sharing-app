import os from 'os';
import { NetworkInterfaceInfo } from './types';

// Patterns to detect virtual, tunnel, or container network adapters
const VIRTUAL_ADAPTER_PATTERNS = [
  /vethernet/i,
  /hyper-v/i,
  /virtualbox/i,
  /vmware/i,
  /docker/i,
  /wsl/i,
  /tailscale/i,
  /zerotier/i,
  /tap/i,
  /tun/i,
  /wireguard/i,
  /loopback/i,
  /bridge/i,
  /nordvpn/i,
  /expressvpn/i
];

/**
 * Checks if an IPv4 address is in a standard private subnet (RFC 1918)
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  // 10.0.0.0 – 10.255.255.255
  if (parts[0] === 10) return true;
  // 172.16.0.0 – 172.31.255.255
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0 – 192.168.255.255
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

/**
 * Checks if an IPv4 address is an APIPA link-local address (169.254.x.x)
 */
export function isLinkLocalIPv4(ip: string): boolean {
  return ip.startsWith('169.254.');
}

/**
 * Checks if an interface name is likely a virtual adapter
 */
export function isVirtualInterface(name: string): boolean {
  return VIRTUAL_ADAPTER_PATTERNS.some(pattern => pattern.test(name));
}

/**
 * Retrieves and filters available network interfaces on the host.
 * Returns sorted interfaces with the most suitable LAN interface marked as recommended.
 */
export function getNetworkInterfaces(): NetworkInterfaceInfo[] {
  const interfaces = os.networkInterfaces();
  const results: NetworkInterfaceInfo[] = [];

  for (const [name, netList] of Object.entries(interfaces)) {
    if (!netList) continue;

    for (const net of netList) {
      // We focus on IPv4 for LAN sharing
      if (net.family === 'IPv4' && !net.internal && !isLinkLocalIPv4(net.address)) {
        results.push({
          name,
          address: net.address,
          family: 'IPv4',
          internal: net.internal,
          mac: net.mac,
          isRecommended: false
        });
      }
    }
  }

  if (results.length === 0) {
    // Fallback if no external network is found (e.g. offline local testing)
    return [
      {
        name: 'Loopback',
        address: '127.0.0.1',
        family: 'IPv4',
        internal: true,
        mac: '00:00:00:00:00:00',
        isRecommended: true
      }
    ];
  }

  // Score interfaces to recommend the best physical LAN interface:
  // 1. Non-virtual interface + Private IPv4 (Highest)
  // 2. Non-virtual interface + other IPv4
  // 3. Virtual interface + Private IPv4
  // 4. Other
  const scored = results.map(item => {
    let score = 0;
    const isVirt = isVirtualInterface(item.name);
    const isPriv = isPrivateIPv4(item.address);

    if (!isVirt) score += 100;
    if (isPriv) score += 50;
    // Prefer Wi-Fi / Ethernet naming common on Windows
    if (/wi-fi|wlan|wireless|ethernet|eth|en/i.test(item.name)) score += 20;

    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Mark the highest scored as recommended
  if (scored.length > 0) {
    scored[0].item.isRecommended = true;
  }

  return scored.map(s => s.item);
}

/**
 * Gets the primary recommended local IPv4 address for LAN sharing.
 */
export function getPrimaryLocalIp(): string {
  const ifaces = getNetworkInterfaces();
  const recommended = ifaces.find(i => i.isRecommended);
  return recommended ? recommended.address : (ifaces[0]?.address || '127.0.0.1');
}
