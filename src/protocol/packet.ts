/**
 * GhostNet Binary Packet Encoder / Decoder / Validator
 */

import {
  PACKET_BYTE_LENGTH,
  MAX_HOPS,
  GEO_SCALE,
  DEFAULT_GHOSTNET_SECRET,
} from "./constants";
import {
  CrisisType,
  CRISIS_TYPE_NAMES,
  GhostNetPacket,
  DecodedGhostNetPacket,
  PacketValidationResult,
} from "./types";
import {
  computePacketHmac,
  getCurrentTimestampMinutes,
  generateAnonymousDeviceId,
} from "./crypto";

/**
 * Encodes a GhostNetPacket into an exact 20-byte Uint8Array binary buffer.
 */
export function encodePacket(
  packet: Partial<GhostNetPacket> & {
    latitude: number;
    longitude: number;
    crisisType: CrisisType;
    urgency: number;
  },
  secret: string = DEFAULT_GHOSTNET_SECRET
): Uint8Array {
  const buffer = new Uint8Array(PACKET_BYTE_LENGTH);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // 1. Device ID (4 bytes, uint32)
  const deviceId = packet.deviceId ?? generateAnonymousDeviceId();
  view.setUint32(0, deviceId, false); // Big-Endian

  // 2. Scaled Latitude (4 bytes, int32)
  const scaledLat = Math.round(packet.latitude * GEO_SCALE);
  view.setInt32(4, scaledLat, false);

  // 3. Scaled Longitude (4 bytes, int32)
  const scaledLng = Math.round(packet.longitude * GEO_SCALE);
  view.setInt32(8, scaledLng, false);

  // 4. Crisis Type (1 byte, uint8)
  const crisis = packet.crisisType in CrisisType ? packet.crisisType : CrisisType.OTHER;
  view.setUint8(12, crisis);

  // 5. Urgency (1 byte, uint8: clamp 1-9)
  const urgency = Math.min(9, Math.max(1, packet.urgency ?? 5));
  view.setUint8(13, urgency);

  // 6. Battery (1 byte, uint8: clamp 0-100)
  const battery = Math.min(100, Math.max(0, packet.battery ?? 100));
  view.setUint8(14, battery);

  // 7. Hop Count + Flags (1 byte, uint8)
  // Low 4 bits: hopCount (0-15)
  // High 4 bits: flags (bit 4: isTest, bit 5: isDirectOrigin)
  const hopCount = Math.min(15, Math.max(0, packet.hopCount ?? 0));
  const flags = (packet.flags ?? (packet.hopCount === 0 ? 0x20 : 0x00)) & 0xf0;
  const hopAndFlags = (flags & 0xf0) | (hopCount & 0x0f);
  view.setUint8(15, hopAndFlags);

  // 8. Timestamp Minutes (2 bytes, uint16)
  const timestampMinutes = packet.timestampMinutes ?? getCurrentTimestampMinutes();
  view.setUint16(16, timestampMinutes, false);

  // 9. Integrity HMAC / Checksum (2 bytes, uint16)
  const hmac = packet.hmac ?? computePacketHmac(buffer, 18, secret);
  view.setUint16(18, hmac, false);

  return buffer;
}

/**
 * Decodes a 20-byte binary buffer into a structured DecodedGhostNetPacket.
 */
export function decodePacket(
  buffer: Uint8Array,
  secret: string = DEFAULT_GHOSTNET_SECRET
): DecodedGhostNetPacket {
  if (buffer.length < PACKET_BYTE_LENGTH) {
    throw new Error(
      `Invalid GhostNet packet length: expected ${PACKET_BYTE_LENGTH} bytes, got ${buffer.length}`
    );
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, PACKET_BYTE_LENGTH);

  const deviceId = view.getUint32(0, false);
  const scaledLat = view.getInt32(4, false);
  const scaledLng = view.getInt32(8, false);
  const crisisType = view.getUint8(12) as CrisisType;
  const urgency = view.getUint8(13);
  const battery = view.getUint8(14);
  const hopAndFlags = view.getUint8(15);
  const timestampMinutes = view.getUint16(16, false);
  const hmac = view.getUint16(18, false);

  const hopCount = hopAndFlags & 0x0f;
  const flags = hopAndFlags & 0xf0;
  const isTest = (flags & 0x10) !== 0;
  const isDirectOrigin = (flags & 0x20) !== 0;

  const latitude = scaledLat / GEO_SCALE;
  const longitude = scaledLng / GEO_SCALE;

  // Deduplication identifier (device ID + timestamp bucket)
  const packetId = `${deviceId.toString(16).padStart(8, "0")}-${timestampMinutes.toString(16).padStart(4, "0")}`;

  const crisisName = CRISIS_TYPE_NAMES[crisisType] || "Unknown Emergency";

  return {
    deviceId,
    latitude,
    longitude,
    crisisType,
    urgency,
    battery,
    hopCount,
    flags,
    timestampMinutes,
    hmac,
    packetId,
    isTest,
    isDirectOrigin,
    crisisName,
    receivedAt: new Date().toISOString(),
  };
}

/**
 * Validates packet bounds, coordinates, hop limits, and HMAC integrity.
 */
export function validatePacket(
  buffer: Uint8Array,
  secret: string = DEFAULT_GHOSTNET_SECRET,
  maxAgeMinutes: number = 1440 // 24 hours
): PacketValidationResult {
  if (buffer.length < PACKET_BYTE_LENGTH) {
    return {
      valid: false,
      reason: `Buffer length ${buffer.length} < ${PACKET_BYTE_LENGTH}`,
    };
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, PACKET_BYTE_LENGTH);
  const receivedHmac = view.getUint16(18, false);
  const expectedHmac = computePacketHmac(buffer, 18, secret);

  if (receivedHmac !== expectedHmac) {
    return {
      valid: false,
      reason: `HMAC mismatch: received 0x${receivedHmac.toString(16)}, expected 0x${expectedHmac.toString(16)}`,
    };
  }

  const scaledLat = view.getInt32(4, false);
  const scaledLng = view.getInt32(8, false);
  const lat = scaledLat / GEO_SCALE;
  const lng = scaledLng / GEO_SCALE;

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { valid: false, reason: `Coordinates out of range: (${lat}, ${lng})` };
  }

  const hopAndFlags = view.getUint8(15);
  const hopCount = hopAndFlags & 0x0f;
  if (hopCount > MAX_HOPS) {
    return { valid: false, reason: `Hop count ${hopCount} exceeds maximum ${MAX_HOPS}` };
  }

  // Replay & Expiration check (within maxAgeMinutes)
  const timestampMinutes = view.getUint16(16, false);
  const currentMinutes = getCurrentTimestampMinutes();
  // Handle circular 16-bit delta
  const diffMinutes = (currentMinutes - timestampMinutes + 65536) % 65536;
  if (diffMinutes > maxAgeMinutes && diffMinutes < 65536 - 60) {
    // expired packet
    return { valid: false, reason: `Packet expired: age is ${diffMinutes} minutes` };
  }

  return { valid: true };
}

/**
 * Increments the hop count of a packet for mesh relay forwarding.
 * Returns null if packet has reached MAX_HOPS limit.
 */
export function incrementHop(
  buffer: Uint8Array,
  secret: string = DEFAULT_GHOSTNET_SECRET
): Uint8Array | null {
  if (buffer.length < PACKET_BYTE_LENGTH) return null;

  const copy = new Uint8Array(buffer.slice(0, PACKET_BYTE_LENGTH));
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);

  const hopAndFlags = view.getUint8(15);
  const currentHop = hopAndFlags & 0x0f;

  if (currentHop >= MAX_HOPS) {
    return null; // Hop limit reached, do not forward
  }

  const newHop = currentHop + 1;
  // Clear direct origin bit when relaying
  const flags = (hopAndFlags & 0xf0) & ~0x20;
  view.setUint8(15, flags | (newHop & 0x0f));

  // Recompute HMAC since hop/flags byte changed
  const newHmac = computePacketHmac(copy, 18, secret);
  view.setUint16(18, newHmac, false);

  return copy;
}

/** Helper to convert Uint8Array to Hex string */
export function toHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Helper to convert Hex string to Uint8Array */
export function fromHex(hex: string): Uint8Array {
  const cleanHex = hex.replace(/[^0-9a-fA-F]/g, "");
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

