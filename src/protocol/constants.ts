/**
 * GhostNet Protocol Constants
 */

// Binary packet size in bytes (fits comfortably within legacy 31-byte BLE advertising frame)
export const PACKET_BYTE_LENGTH = 20;

// Maximum mesh forwarding hops before packet is dropped
export const MAX_HOPS = 10;

// Coordinate scaling factor for microdegree fixed-point integer encoding
// Range: -90.000000 to +90.000000 lat -> -90000000 to +90000000
// Accuracy: ~0.11 meters (~11cm), ideal for emergency rescue locating
export const GEO_SCALE = 1_000_000;

// BLE Identifiers
export const GHOSTNET_SERVICE_UUID = "0000FD6F-0000-1000-8000-00805F9B34FB";
export const GHOSTNET_16BIT_UUID = 0xFD6F;
export const GHOSTNET_MANUFACTURER_ID = 0x474e; // ASCII 'G' (0x47), 'N' (0x4E)

// Emergency network secret for basic packet authentication & HMAC verification
// In production/alliance this is rotated daily or per incident
export const DEFAULT_GHOSTNET_SECRET = "GhostNet-Rescue-Emergency-Protocol-v1";

