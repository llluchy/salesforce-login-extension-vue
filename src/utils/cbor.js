// ============================================
// CBOR 编码器（ES module 版，用于 WebAuthn attestation object）
// 参考 Bitwarden 实现：仅编码 WebAuthn 所需的数据类型
// ============================================

// CBOR Major Types
const UNSIGNED_INT = 0;
const NEGATIVE_INT = 1;
const BYTE_STRING = 2;
const TEXT_STRING = 3;
const ARRAY = 4;
const MAP = 5;

class CBOREncoder {
  constructor() {
    this.bytes = [];
  }

  getBuffer() {
    return new Uint8Array(this.bytes).buffer;
  }

  encode(value) {
    if (value === null) {
      this.encodeNull();
    } else if (value === true) {
      this.encodeTrue();
    } else if (value === false) {
      this.encodeFalse();
    } else if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        if (value >= 0) {
          this.encodeUnsignedInt(value);
        } else {
          this.encodeNegativeInt(value);
        }
      } else {
        this.encodeFloat(value);
      }
    } else if (typeof value === 'string') {
      this.encodeTextString(value);
    } else if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
      const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
      this.encodeByteString(bytes);
    } else if (Array.isArray(value)) {
      this.encodeArray(value);
    } else if (typeof value === 'object') {
      this.encodeMap(value);
    }
  }

  encodeHead(majorType, value) {
    if (value < 24) {
      this.bytes.push((majorType << 5) | value);
    } else if (value <= 0xff) {
      this.bytes.push((majorType << 5) | 24);
      this.bytes.push(value);
    } else if (value <= 0xffff) {
      this.bytes.push((majorType << 5) | 25);
      this.bytes.push((value >> 8) & 0xff);
      this.bytes.push(value & 0xff);
    } else if (value <= 0xffffffff) {
      this.bytes.push((majorType << 5) | 26);
      this.bytes.push((value >> 24) & 0xff);
      this.bytes.push((value >> 16) & 0xff);
      this.bytes.push((value >> 8) & 0xff);
      this.bytes.push(value & 0xff);
    } else {
      this.bytes.push((majorType << 5) | 27);
      for (let i = 56; i >= 0; i -= 8) {
        this.bytes.push((value >> i) & 0xff);
      }
    }
  }

  encodeUnsignedInt(value) {
    this.encodeHead(UNSIGNED_INT, value);
  }

  encodeNegativeInt(value) {
    this.encodeHead(NEGATIVE_INT, -(value + 1));
  }

  encodeFloat(value) {
    this.bytes.push((UNSIGNED_INT << 5) | 27);
    const buffer = new ArrayBuffer(8);
    new Float64Array(buffer)[0] = value;
    this.bytes.push(...new Uint8Array(buffer));
  }

  encodeByteString(bytes) {
    this.encodeHead(BYTE_STRING, bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      this.bytes.push(bytes[i]);
    }
  }

  encodeTextString(str) {
    const encoded = new TextEncoder().encode(str);
    this.encodeHead(TEXT_STRING, encoded.length);
    for (let i = 0; i < encoded.length; i++) {
      this.bytes.push(encoded[i]);
    }
  }

  encodeArray(arr) {
    this.encodeHead(ARRAY, arr.length);
    for (const item of arr) {
      this.encode(item);
    }
  }

  encodeMap(obj) {
    const keys = Object.keys(obj);
    keys.sort((a, b) => {
      const numA = parseInt(a);
      const numB = parseInt(b);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return a < b ? -1 : 1;
    });
    this.encodeHead(MAP, keys.length);
    for (const key of keys) {
      const numKey = parseInt(key);
      if (!isNaN(numKey)) {
        if (numKey >= 0) {
          this.encodeUnsignedInt(numKey);
        } else {
          this.encodeNegativeInt(numKey);
        }
      } else {
        this.encode(key);
      }
      this.encode(obj[key]);
    }
  }

  encodeNull() {
    this.bytes.push((UNSIGNED_INT << 5) | 22);
  }

  encodeTrue() {
    this.bytes.push((UNSIGNED_INT << 5) | 21);
  }

  encodeFalse() {
    this.bytes.push((UNSIGNED_INT << 5) | 20);
  }
}

class CBORDecoder {
  constructor(data) {
    this.data = data;
    this.offset = 0;
  }

  decode() {
    if (this.offset >= this.data.length) {
      throw new Error('Unexpected end of CBOR data');
    }

    const byte = this.data[this.offset++];
    const majorType = (byte >> 5) & 0x07;
    const additionalInfo = byte & 0x1f;

    switch (majorType) {
      case UNSIGNED_INT:
        return this.decodeUnsignedInt(additionalInfo);
      case NEGATIVE_INT:
        return this.decodeNegativeInt(additionalInfo);
      case BYTE_STRING:
        return this.decodeByteString(additionalInfo);
      case TEXT_STRING:
        return this.decodeTextString(additionalInfo);
      case ARRAY:
        return this.decodeArray(additionalInfo);
      case MAP:
        return this.decodeMap(additionalInfo);
      default:
        throw new Error('Unsupported CBOR major type: ' + majorType);
    }
  }

  decodeLength(additionalInfo) {
    if (additionalInfo < 24) return additionalInfo;
    if (additionalInfo === 24) return this.data[this.offset++];
    if (additionalInfo === 25) {
      const value = (this.data[this.offset] << 8) | this.data[this.offset + 1];
      this.offset += 2;
      return value;
    }
    if (additionalInfo === 26) {
      const value = (this.data[this.offset] << 24) | (this.data[this.offset + 1] << 16) |
                    (this.data[this.offset + 2] << 8) | this.data[this.offset + 3];
      this.offset += 4;
      return value;
    }
    throw new Error('CBOR length too large');
  }

  decodeUnsignedInt(additionalInfo) {
    return this.decodeLength(additionalInfo);
  }

  decodeNegativeInt(additionalInfo) {
    return -(this.decodeLength(additionalInfo) + 1);
  }

  decodeByteString(additionalInfo) {
    const length = this.decodeLength(additionalInfo);
    const bytes = this.data.slice(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }

  decodeTextString(additionalInfo) {
    const length = this.decodeLength(additionalInfo);
    const bytes = this.data.slice(this.offset, this.offset + length);
    this.offset += length;
    return new TextDecoder().decode(bytes);
  }

  decodeArray(additionalInfo) {
    const length = this.decodeLength(additionalInfo);
    const arr = [];
    for (let i = 0; i < length; i++) {
      arr.push(this.decode());
    }
    return arr;
  }

  decodeMap(additionalInfo) {
    const length = this.decodeLength(additionalInfo);
    const obj = {};
    for (let i = 0; i < length; i++) {
      const key = this.decode();
      const value = this.decode();
      obj[key] = value;
    }
    return obj;
  }
}

export const CBOR = {
  encode(value) {
    const encoder = new CBOREncoder();
    encoder.encode(value);
    return encoder.getBuffer();
  },

  decode(buffer) {
    const data = new Uint8Array(buffer);
    const decoder = new CBORDecoder(data);
    return decoder.decode();
  }
};