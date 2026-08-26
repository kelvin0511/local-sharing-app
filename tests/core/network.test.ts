import { describe, it, expect } from 'vitest';
import {
  isPrivateIPv4,
  isLinkLocalIPv4,
  isVirtualInterface,
  getNetworkInterfaces,
  getPrimaryLocalIp
} from '../../src/core/network';

describe('Network Utilities', () => {
  it('correctly identifies private IPv4 address ranges', () => {
    // 10.x.x.x
    expect(isPrivateIPv4('10.0.0.1')).toBe(true);
    expect(isPrivateIPv4('10.255.255.254')).toBe(true);

    // 172.16.x.x - 172.31.x.x
    expect(isPrivateIPv4('172.16.0.1')).toBe(true);
    expect(isPrivateIPv4('172.24.10.5')).toBe(true);
    expect(isPrivateIPv4('172.31.255.255')).toBe(true);
    expect(isPrivateIPv4('172.32.0.1')).toBe(false);

    // 192.168.x.x
    expect(isPrivateIPv4('192.168.1.100')).toBe(true);
    expect(isPrivateIPv4('192.168.0.1')).toBe(true);

    // Public / invalid IPs
    expect(isPrivateIPv4('8.8.8.8')).toBe(false);
    expect(isPrivateIPv4('1.1.1.1')).toBe(false);
    expect(isPrivateIPv4('127.0.0.1')).toBe(false);
    expect(isPrivateIPv4('invalid-ip')).toBe(false);
  });

  it('correctly identifies APIPA link-local addresses', () => {
    expect(isLinkLocalIPv4('169.254.10.20')).toBe(true);
    expect(isLinkLocalIPv4('192.168.1.1')).toBe(false);
  });

  it('correctly detects virtual adapter names', () => {
    expect(isVirtualInterface('vEthernet (WSL)')).toBe(true);
    expect(isVirtualInterface('Hyper-V Virtual Ethernet Adapter')).toBe(true);
    expect(isVirtualInterface('VirtualBox Host-Only Ethernet Adapter')).toBe(true);
    expect(isVirtualInterface('docker0')).toBe(true);
    expect(isVirtualInterface('Tailscale')).toBe(true);
    expect(isVirtualInterface('Wi-Fi')).toBe(false);
    expect(isVirtualInterface('Ethernet')).toBe(false);
  });

  it('returns valid network interfaces and a primary local IP', () => {
    const interfaces = getNetworkInterfaces();
    expect(interfaces.length).toBeGreaterThan(0);

    const primaryIp = getPrimaryLocalIp();
    expect(primaryIp).toBeDefined();
    expect(primaryIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/);

    const recommended = interfaces.find(i => i.isRecommended);
    expect(recommended).toBeDefined();
    expect(recommended?.address).toBe(primaryIp);
  });
});
