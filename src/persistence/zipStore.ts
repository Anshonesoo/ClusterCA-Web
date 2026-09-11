const encoder = new TextEncoder();
const decoder = new TextDecoder();

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[n] = value >>> 0;
}

const crc32 = (data: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

const viewWithSize = (size: number): { bytes: Uint8Array; view: DataView } => {
  const bytes = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
};

export interface ZipFile {
  readonly name: string;
  readonly data: Uint8Array;
}

export const createStoredZip = (filesInput: readonly ZipFile[]): Uint8Array => {
  const files = [...filesInput].sort((a, b) => a.name.localeCompare(b.name));
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = viewWithSize(30 + name.length);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, 0x0800, true);
    local.view.setUint16(8, 0, true);
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, file.data.length, true);
    local.view.setUint32(22, file.data.length, true);
    local.view.setUint16(26, name.length, true);
    local.bytes.set(name, 30);
    localParts.push(local.bytes, file.data);

    const central = viewWithSize(46 + name.length);
    central.view.setUint32(0, 0x02014b50, true);
    central.view.setUint16(4, 20, true);
    central.view.setUint16(6, 20, true);
    central.view.setUint16(8, 0x0800, true);
    central.view.setUint16(10, 0, true);
    central.view.setUint32(16, crc, true);
    central.view.setUint32(20, file.data.length, true);
    central.view.setUint32(24, file.data.length, true);
    central.view.setUint16(28, name.length, true);
    central.view.setUint32(42, localOffset, true);
    central.bytes.set(name, 46);
    centralParts.push(central.bytes);
    localOffset += local.bytes.length + file.data.length;
  }

  const centralDirectory = concat(centralParts);
  const end = viewWithSize(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(8, files.length, true);
  end.view.setUint16(10, files.length, true);
  end.view.setUint32(12, centralDirectory.length, true);
  end.view.setUint32(16, localOffset, true);
  return concat([...localParts, centralDirectory, end.bytes]);
};

export const readStoredZip = (bytes: Uint8Array): Map<string, Uint8Array> => {
  if (bytes.length < 22) throw new Error("文件过短，不是有效 ZIP");
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("找不到 ZIP 结束记录");
  const end = new DataView(bytes.buffer, bytes.byteOffset + endOffset, 22);
  const count = end.getUint16(10, true);
  let centralOffset = end.getUint32(16, true);
  const files = new Map<string, Uint8Array>();

  for (let index = 0; index < count; index += 1) {
    const central = new DataView(bytes.buffer, bytes.byteOffset + centralOffset);
    if (central.getUint32(0, true) !== 0x02014b50) throw new Error("ZIP 中央目录损坏");
    if (central.getUint16(10, true) !== 0) throw new Error("当前仅支持无压缩 ZIP 条目");
    const expectedCrc = central.getUint32(16, true);
    const size = central.getUint32(24, true);
    const nameLength = central.getUint16(28, true);
    const extraLength = central.getUint16(30, true);
    const commentLength = central.getUint16(32, true);
    const localOffset = central.getUint32(42, true);
    const name = decoder.decode(bytes.subarray(centralOffset + 46, centralOffset + 46 + nameLength));
    const local = new DataView(bytes.buffer, bytes.byteOffset + localOffset);
    if (local.getUint32(0, true) !== 0x04034b50) throw new Error(`ZIP 条目 ${name} 的本地头损坏`);
    const localNameLength = local.getUint16(26, true);
    const localExtraLength = local.getUint16(28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.slice(dataOffset, dataOffset + size);
    if (crc32(data) !== expectedCrc) throw new Error(`ZIP 条目 ${name} 的 CRC 校验失败`);
    if (files.has(name)) throw new Error(`ZIP 包含重复条目：${name}`);
    files.set(name, data);
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
};

export const encodeUtf8 = (text: string): Uint8Array => encoder.encode(text);
export const decodeUtf8 = (data: Uint8Array): string => decoder.decode(data);
