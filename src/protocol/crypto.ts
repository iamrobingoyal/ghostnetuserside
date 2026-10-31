/**
 * GhostNet Cryptographic and Anonymous ID Helpers
 */

import { DEFAULT_GHOSTNET_SECRET } from "./constants";

/**
 * Generates an anonymous 32-bit device ID.
 * Rotates periodically to protect survivor privacy and prevent device tracking.
 */
export function generateAnonymousDeviceId(): number {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return array[0];
  }
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/**
 * Returns the current time in epoch minutes mod 65536.
 * Fits in 2 bytes (uint16) and spans ~45.5 days before wrap-around.
 */
export function getCurrentTimestampMinutes(nowMs: number = Date.now()): number {
  const minutes = Math.floor(nowMs / (60 * 1000));
  return minutes & 0xffff;
}

/**
 * Lightweight pure-JS 16-bit HMAC / CRC16-CCITT keyed integrity checksum.
 * Runs identically in Node.js, React Native, browser, and Android Kotlin.
 *
 * Polynomial: 0x1021 (CRC-CCITT), seeded with key hash.
 */
export function computePacketHmac(
  data: Uint8Array,
  dataLength: number = 18,
  secret: string = DEFAULT_GHOSTNET_SECRET
): number {
  // Hash the secret into a 16-bit seed
  let seed = 0xffff;
  for (let i = 0; i < secret.length; i++) {
    seed = ((seed << 5) - seed + secret.charCodeAt(i)) & 0xffff;
  }

  let crc = seed;
  for (let i = 0; i < dataLength; i++) {
    crc ^= (data[i] & 0xff) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }

  return crc & 0xffff;
}

