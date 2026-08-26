import { describe, it, expect, afterEach } from 'vitest';
import { UDPBroadcaster, UDPDiscoveryListener } from '../../src/core/discovery';

describe('UDP LAN Discovery', () => {
  let broadcaster: UDPBroadcaster | null = null;
  let listener: UDPDiscoveryListener | null = null;

  afterEach(async () => {
    if (broadcaster) {
      await broadcaster.stop();
      broadcaster = null;
    }
    if (listener) {
      await listener.stop();
      listener = null;
    }
  });

  it('broadcasts beacons and discovers senders on LAN', async () => {
    const testPort = 54399; // Isolated test port

    listener = new UDPDiscoveryListener();
    await listener.start(testPort);

    broadcaster = new UDPBroadcaster({
      code: 'X2KTV',
      ip: '127.0.0.1',
      port: 59999,
      token: 'test-token-12345',
      fileCount: 2,
      totalBytes: 2048,
      senderName: 'Test Machine'
    });

    await broadcaster.start(testPort);

    // Wait for beacon delivery
    await new Promise((resolve) => setTimeout(resolve, 300));

    const senders = listener.getDiscoveredSenders();
    expect(senders.length).toBeGreaterThanOrEqual(1);

    const found = listener.findSenderByCode('X2KTV');
    expect(found).toBeDefined();
    expect(found?.code).toBe('X2KTV');
    expect(found?.senderName).toBe('Test Machine');
    expect(found?.fileCount).toBe(2);
    expect(found?.totalBytes).toBe(2048);
  });
});
