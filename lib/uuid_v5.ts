function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (normalized.length !== 32) throw new Error('Invalid UUID (expected 16 bytes).');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

export async function uuidV5(namespaceUuid: string, name: string): Promise<string> {
  const ns = hexToBytes(namespaceUuid);
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(ns.length + nameBytes.length);
  input.set(ns, 0);
  input.set(nameBytes, ns.length);

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', input));
  const out = digest.slice(0, 16);

  // RFC 4122: set version to 5 and variant to RFC 4122.
  out[6] = (out[6] & 0x0f) | 0x50;
  out[8] = (out[8] & 0x3f) | 0x80;

  return bytesToUuid(out);
}
