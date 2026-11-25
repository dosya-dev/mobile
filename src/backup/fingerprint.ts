import * as FileSystem from "expo-file-system/legacy";
import * as Crypto from "expo-crypto";

const CHUNK = 64 * 1024;

export async function computeFingerprint(uri: string, size: number): Promise<string> {
  const head = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64, position: 0, length: CHUNK });
  const tailPos = Math.max(0, size - CHUNK);
  const tail = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64, position: tailPos, length: CHUNK });
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${size}:${head}:${tail}`);
}
