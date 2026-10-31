/**
 * GhostNet Crisis Types and Packet Data Types
 */

export enum CrisisType {
  MEDICAL = 0x01,
  TRAPPED = 0x02,
  FIRE = 0x03,
  FLOOD = 0x04,
  VIOLENCE = 0x05,
  OTHER = 0x06,
}

export const CRISIS_TYPE_NAMES: Record<CrisisType, string> = {
  [CrisisType.MEDICAL]: "Medical",
  [CrisisType.TRAPPED]: "Trapped / Structural",
  [CrisisType.FIRE]: "Fire / Smoke",
  [CrisisType.FLOOD]: "Flood / Water",
  [CrisisType.VIOLENCE]: "Violence / Threat",
  [CrisisType.OTHER]: "Other Emergency",
};

export interface GhostNetPacket {
  /** 4 bytes: Rotating anonymous device ID (0 to 4,294,967,295) */
  deviceId: number;

  /** 4 bytes signed int (microdegrees): -90.000000 to +90.000000 */
  latitude: number;

  /** 4 bytes signed int (microdegrees): -180.000000 to +180.000000 */
  longitude: number;

  /** 1 byte: Crisis category */
  crisisType: CrisisType;

  /** 1 byte: Urgency scale from 1 (lowest) to 9 (critical/life-threatening) */
  urgency: number;

  /** 1 byte: Battery level 0 to 100% */
  battery: number;

  /** 4 bits: Hop count (0 = direct survivor origin, 1..10 = relays) */
  hopCount: number;

  /** 4 bits: Flags (bit 0: isTest, bit 1: isDirectOrigin, bits 2-3: reserved) */
  flags: number;

  /** 2 bytes: Minutes timestamp counter (epoch minutes mod 65536) for replay/expiration */
  timestampMinutes: number;

  /** 2 bytes: Truncated HMAC / integrity checksum */
  hmac: number;
}

export interface DecodedGhostNetPacket extends GhostNetPacket {
  /** Unique deduplication key: hex(deviceId) + "-" + timestampMinutes */
  packetId: string;

  /** Computed flag: true if marked as drill or test packet */
  isTest: boolean;

  /** Computed flag: true if direct from survivor beacon */
  isDirectOrigin: boolean;

  /** Human readable crisis name */
  crisisName: string;

  /** ISO timestamp when decoded or received */
  receivedAt?: string;

  /** Signal strength / RSSI if captured via BLE */
  rssi?: number;
}

export interface PacketValidationResult {
  valid: boolean;
  reason?: string;
}

