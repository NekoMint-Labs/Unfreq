// A deliberately malformed 145-byte archive. A complete ZIP64 end record and
// locator take both supported fflate lines into ZIP64 central-directory parsing.
// The compressed-size sentinel requires a ZIP64 extra field, which is absent.
export function malformedZip64Fixture() {
  const centralSize = 47;
  const zip64 = centralSize;
  const locator = zip64 + 56;
  const end = locator + 20;
  const data = new Uint8Array(end + 22);
  const view = new DataView(data.buffer);
  const u16 = (at, value) => view.setUint16(at, value, true);
  const u32 = (at, value) => view.setUint32(at, value, true);
  const u64 = (at, value) => view.setBigUint64(at, BigInt(value), true);

  u32(0, 0x02014b50);
  u16(4, 45); u16(6, 45);
  u32(20, 0xffffffff);
  u16(28, 1); // One-byte filename; the extra-field length remains zero.
  data[46] = 97;
  u32(zip64, 0x06064b50); u64(zip64 + 4, 44);
  u16(zip64 + 12, 45); u16(zip64 + 14, 45);
  u64(zip64 + 24, 1); u64(zip64 + 32, 1);
  u64(zip64 + 40, centralSize); u64(zip64 + 48, 0);
  u32(locator, 0x07064b50); u64(locator + 8, zip64); u32(locator + 16, 1);
  u32(end, 0x06054b50); u16(end + 8, 1); u16(end + 10, 1);
  u32(end + 12, centralSize); u32(end + 16, 0xffffffff);
  return data;
}

// A complete stored ZIP64 archive containing a="ok". An unrelated extra field
// precedes tag 0x0001, so a bounds fix must still scan valid unknown fields.
export function validZip64Fixture() {
  const payload = new Uint8Array([111, 107]);
  const localSize = 31 + payload.length;
  const centralSize = 47 + 32;
  const central = localSize;
  const zip64 = central + centralSize;
  const locator = zip64 + 56;
  const end = locator + 20;
  const data = new Uint8Array(end + 22);
  const view = new DataView(data.buffer);
  const u16 = (at, value) => view.setUint16(at, value, true);
  const u32 = (at, value) => view.setUint32(at, value, true);
  const u64 = (at, value) => view.setBigUint64(at, BigInt(value), true);
  const crc = 0x79dcdd47; // IEEE CRC32 of the fixed UTF-8 payload "ok".

  u32(0, 0x04034b50); u16(4, 45);
  u32(14, crc); u32(18, payload.length); u32(22, payload.length);
  u16(26, 1); data[30] = 97; data.set(payload, 31);
  u32(central, 0x02014b50); u16(central + 4, 45); u16(central + 6, 45);
  u32(central + 16, crc);
  u32(central + 20, 0xffffffff); u32(central + 24, 0xffffffff);
  u16(central + 28, 1); u16(central + 30, 32);
  u32(central + 42, 0xffffffff); data[central + 46] = 97;
  const extra = central + 47;
  u16(extra, 0xcafe); u16(extra + 2, 0);
  u16(extra + 4, 1); u16(extra + 6, 24);
  u64(extra + 8, payload.length); u64(extra + 16, payload.length); u64(extra + 24, 0);
  u32(zip64, 0x06064b50); u64(zip64 + 4, 44);
  u16(zip64 + 12, 45); u16(zip64 + 14, 45);
  u64(zip64 + 24, 1); u64(zip64 + 32, 1);
  u64(zip64 + 40, centralSize); u64(zip64 + 48, central);
  u32(locator, 0x07064b50); u64(locator + 8, zip64); u32(locator + 16, 1);
  u32(end, 0x06054b50); u16(end + 8, 1); u16(end + 10, 1);
  u32(end + 12, centralSize); u32(end + 16, 0xffffffff);
  return data;
}
