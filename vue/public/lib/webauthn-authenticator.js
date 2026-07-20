// ============================================
// WebAuthn 软件认证器
// 参考 Bitwarden 实现，完全在扩展内完成 Passkey 创建和验证
// 不依赖系统 Passkey（Windows Hello 等）
// ============================================

const WebAuthnAuthenticator = {
  AAGUID: new Uint8Array([0xa2, 0x8c, 0x3d, 0xf7, 0x1b, 0x5e, 0x4a, 0x89,
                          0x9c, 0xd0, 0x2e, 0x6f, 0xb3, 0x41, 0x7a, 0xd8]),

  async makeCredential(options, origin) {
    const rpId = options.rpId || options.rp?.id || new URL(origin).hostname;
    const userId = options.user?.id || new Uint8Array(0);
    const userName = options.user?.name || '';
    const userDisplayName = options.user?.displayName || '';

    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );

    const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

    const credentialId = crypto.getRandomValues(new Uint8Array(64));
    const cosePublicKey = this._jwkToCoseKey(publicKeyJwk);
    const attestedCredData = this._buildAttestedCredentialData(credentialId, cosePublicKey);

    const rpIdHash = await this._sha256(rpId);
    const flags = 0x41;
    const signCount = 0;
    const authData = this._buildAuthData(rpIdHash, flags, signCount, attestedCredData);

    let challengeBuf = options.challenge;
    if (options.challenge instanceof Uint8Array) {
      challengeBuf = options.challenge.buffer;
    } else if (options.challenge && typeof options.challenge === 'object' && options.challenge.buffer) {
      challengeBuf = options.challenge.buffer;
    }
    const challengeBase64url = (challengeBuf instanceof ArrayBuffer)
      ? this._arrayBufferToBase64url(challengeBuf)
      : String(challengeBuf);

    const clientDataJSON = JSON.stringify({
      type: 'webauthn.create',
      challenge: challengeBase64url,
      origin: origin,
      crossOrigin: false
    });
    const clientDataJSONBuffer = new TextEncoder().encode(clientDataJSON);

    const attestationObject = CBOR.encode({
      fmt: 'none',
      attStmt: {},
      authData: new Uint8Array(authData)
    });

    const response = {
      clientDataJSON: clientDataJSONBuffer.buffer,
      attestationObject: attestationObject,
      challenge: challengeBase64url,
      origin: origin,
    };

    Object.defineProperty(response, 'getAuthenticatorData', {
      value: () => authData.buffer,
      enumerable: false,
      configurable: true,
      writable: true
    });

    Object.defineProperty(response, 'getPublicKey', {
      value: () => {
        const pkBytes = CBOR.encode(cosePublicKey);
        return new Uint8Array(pkBytes).buffer;
      },
      enumerable: false,
      configurable: true,
      writable: true
    });

    Object.defineProperty(response, 'getPublicKeyAlgorithm', {
      value: () => -7,
      enumerable: false,
      configurable: true,
      writable: true
    });

    Object.defineProperty(response, 'getTransports', {
      value: () => ['internal'],
      enumerable: false,
      configurable: true,
      writable: true
    });

    const credential = {
      id: this._arrayBufferToBase64url(credentialId.buffer),
      rawId: credentialId.buffer,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: response,
    };

    Object.defineProperty(credential, 'getClientExtensionResults', {
      value: () => ({ credProps: { rk: true } }),
      enumerable: false,
      configurable: true,
      writable: true
    });

    const self = this;
    response.toJSON = function() {
      return {
        challenge: challengeBase64url,
        origin: origin,
        clientDataJSON: self._arrayBufferToBase64url(clientDataJSONBuffer.buffer),
        attestationObject: self._arrayBufferToBase64url(attestationObject),
        transports: ['internal'],
        getPublicKeyAlgorithm: -7,
        getTransports: ['internal'],
        getAuthenticatorData: self._arrayBufferToBase64url(authData.buffer),
        getPublicKey: self._arrayBufferToBase64url(new Uint8Array(CBOR.encode(cosePublicKey)).buffer),
      };
    };

    credential.toJSON = function() {
      return {
        id: credential.id,
        rawId: credential.id,
        type: credential.type,
        authenticatorAttachment: credential.authenticatorAttachment,
        response: response.toJSON(),
        clientExtensionResults: credential.getClientExtensionResults(),
      };
    };

    const userIdBase64url = this._arrayBufferToBase64url(
      userId instanceof ArrayBuffer ? userId : userId.buffer
    );

    const privateKeyData = {
      credentialId: credential.id,
      rpId: rpId,
      privateKeyJwk: privateKeyJwk,
      publicKeyJwk: publicKeyJwk,
      userId: userIdBase64url,
      userName: userName,
      userDisplayName: userDisplayName,
      signCount: 0,
      createdAt: Date.now()
    };

    return { credential, privateKeyData };
  },

  async getAssertion(options, origin, storedCredentials) {
    const rpId = options.rpId || new URL(origin).hostname;

    let matchedCredential = null;
    const allowCredentials = options.allowCredentials || [];

    if (allowCredentials.length > 0) {
      for (const allowCred of allowCredentials) {
        const credId = typeof allowCred === 'string' ? allowCred : allowCred.id;
        matchedCredential = storedCredentials.find(c => c.credentialId === credId);
        if (matchedCredential) break;
      }
    } else {
      matchedCredential = storedCredentials.find(c => c.rpId === rpId);
    }

    if (!matchedCredential) {
      return null;
    }

    const privateKey = await crypto.subtle.importKey(
      'jwk',
      matchedCredential.privateKeyJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );

    const rpIdHash = await this._sha256(rpId);
    const flags = 0x05;
    const signCount = ++matchedCredential.signCount;
    const authData = this._buildAuthData(rpIdHash, flags, signCount, null);

    let challengeBuf = options.challenge;
    if (options.challenge instanceof Uint8Array) {
      challengeBuf = options.challenge.buffer;
    } else if (options.challenge && typeof options.challenge === 'object' && options.challenge.buffer) {
      challengeBuf = options.challenge.buffer;
    }
    const challengeBase64url = (challengeBuf instanceof ArrayBuffer)
      ? this._arrayBufferToBase64url(challengeBuf)
      : String(challengeBuf);

    const clientDataJSON = JSON.stringify({
      type: 'webauthn.get',
      challenge: challengeBase64url,
      origin: origin,
      crossOrigin: false
    });
    const clientDataJSONBuffer = new TextEncoder().encode(clientDataJSON);

    const clientDataHash = await this._sha256(clientDataJSONBuffer);
    const signatureBase = this._concatBuffers(authData.buffer, clientDataHash);

    const p1363Signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      privateKey,
      signatureBase
    );
    // WebAuthn 规范要求 ECDSA 签名为 DER (ASN.1) 格式，
    // 但 Web Crypto API 返回 P-1363 (r || s) 格式，需要转换
    const rawSignature = this._p1363ToDer(new Uint8Array(p1363Signature)).buffer;

    const credentialIdBytes = this._base64urlToArrayBuffer(matchedCredential.credentialId);
    const userHandle = matchedCredential.userId
      ? this._base64urlToUint8Array(matchedCredential.userId)
      : (matchedCredential.userName ? new TextEncoder().encode(matchedCredential.userName) : new Uint8Array(0));

    const credential = {
      id: matchedCredential.credentialId,
      rawId: credentialIdBytes,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        authenticatorData: authData.buffer,
        clientDataJSON: clientDataJSONBuffer.buffer,
        signature: rawSignature,
        userHandle: userHandle.buffer,
        challenge: challengeBase64url,
        origin: origin,
      },
    };

    Object.defineProperty(credential, 'getClientExtensionResults', {
      value: () => ({}),
      enumerable: false,
      configurable: true,
      writable: true
    });

    const self = this;
    credential.response.toJSON = function() {
      return {
        challenge: challengeBase64url,
        origin: origin,
        clientDataJSON: self._arrayBufferToBase64url(clientDataJSONBuffer.buffer),
        authenticatorData: self._arrayBufferToBase64url(authData.buffer),
        signature: self._arrayBufferToBase64url(rawSignature),
        userHandle: userHandle && userHandle.length > 0 ? self._arrayBufferToBase64url(userHandle.buffer) : null,
      };
    };

    credential.toJSON = function() {
      return {
        id: credential.id,
        rawId: credential.id,
        type: credential.type,
        authenticatorAttachment: credential.authenticatorAttachment,
        response: credential.response.toJSON(),
        clientExtensionResults: credential.getClientExtensionResults(),
      };
    };

    matchedCredential.signCount = signCount;

    return { credential, updatedCredential: matchedCredential };
  },

  _jwkToCoseKey(jwk) {
    const x = this._base64urlToUint8Array(jwk.x);
    const y = this._base64urlToUint8Array(jwk.y);

    return {
      1: 2,
      3: -7,
      '-1': 1,
      '-2': x,
      '-3': y,
    };
  },

  _buildAttestedCredentialData(credentialId, cosePublicKey) {
    const coseKeyBytes = new Uint8Array(CBOR.encode(cosePublicKey));
    const result = new Uint8Array(16 + 2 + credentialId.length + coseKeyBytes.length);

    result.set(this.AAGUID, 0);
    result[16] = (credentialId.length >> 8) & 0xff;
    result[17] = credentialId.length & 0xff;
    result.set(credentialId, 18);
    result.set(coseKeyBytes, 18 + credentialId.length);

    return result;
  },

  _buildAuthData(rpIdHash, flags, signCount, attestedCredData) {
    let totalLength = 32 + 1 + 4;
    if (attestedCredData) {
      totalLength += attestedCredData.length;
    }

    const result = new Uint8Array(totalLength);

    result.set(new Uint8Array(rpIdHash), 0);
    result[32] = flags;
    result[33] = (signCount >> 24) & 0xff;
    result[34] = (signCount >> 16) & 0xff;
    result[35] = (signCount >> 8) & 0xff;
    result[36] = signCount & 0xff;

    if (attestedCredData) {
      result.set(attestedCredData, 37);
    }

    return result;
  },

  async _sha256(data) {
    const buffer = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    return await crypto.subtle.digest('SHA-256', buffer);
  },

  _concatBuffers(a, b) {
    const result = new Uint8Array(a.byteLength + b.byteLength);
    result.set(new Uint8Array(a), 0);
    result.set(new Uint8Array(b), a.byteLength);
    return result.buffer;
  },

  _p1363ToDer(signature) {
    const n = signature.length / 2;
    const r = signature.slice(0, n);
    const s = signature.slice(n);

    const rDer = this._integerToDer(r);
    const sDer = this._integerToDer(s);

    // rDer 和 sDer 已包含各自的 [0x02, length] 头部,
    // SEQUENCE 内容长度 = rDer.length + sDer.length,不需要额外加 2
    const totalLength = rDer.length + sDer.length;
    const result = new Uint8Array(2 + totalLength);

    result[0] = 0x30;
    result[1] = totalLength;
    result.set(rDer, 2);
    result.set(sDer, 2 + rDer.length);

    return result;
  },

  _integerToDer(bytes) {
    let offset = 0;
    while (offset < bytes.length && bytes[offset] === 0) offset++;

    let trimmed = bytes.slice(offset);

    if (trimmed.length === 0) trimmed = new Uint8Array([0]);

    if (trimmed[0] & 0x80) {
      const padded = new Uint8Array(trimmed.length + 1);
      padded.set(trimmed, 1);
      trimmed = padded;
    }

    const result = new Uint8Array(2 + trimmed.length);
    result[0] = 0x02;
    result[1] = trimmed.length;
    result.set(trimmed, 2);

    return result;
  },

  _arrayBufferToBase64url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  },

  _base64urlToUint8Array(base64url) {
    const padding = '='.repeat((4 - base64url.length % 4) % 4);
    const b64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      bytes[i] = raw.charCodeAt(i);
    }
    return bytes;
  },

  _base64urlToArrayBuffer(base64url) {
    return this._base64urlToUint8Array(base64url).buffer;
  }
};
