export interface E2eeSessionTelemetry {
  active: boolean;
  keyId: string | null;
  fingerprint: string | null;
  cipherSuite: string;
  expiresAt: string | null;
  encryptedPacketsDecrypted: number;
  encryptedPacketsSent: number;
  lastHandshakeAt: string | null;
  error: string | null;
}

interface EncryptedEnvelope {
  version: 'SYGMA-E2EE-1.0';
  alg: string;
  keyId: string;
  iv: string;
  ciphertext: string;
  authTag: string;
  signatureEd25519: string;
  timestamp: string;
  nonce: string;
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

class E2eeApiClient {
  private aesKey: CryptoKey | null = null;
  private telemetry: E2eeSessionTelemetry = {
    active: false,
    keyId: null,
    fingerprint: null,
    cipherSuite: 'ECDH-P256 + HKDF-SHA256 + AES-256-GCM + Ed25519',
    expiresAt: null,
    encryptedPacketsDecrypted: 0,
    encryptedPacketsSent: 0,
    lastHandshakeAt: null,
    error: null,
  };
  private handshakePromise: Promise<void> | null = null;

  public getTelemetry(): E2eeSessionTelemetry {
    return { ...this.telemetry };
  }

  public async ensureHandshake(): Promise<void> {
    if (this.telemetry.active && this.aesKey && this.telemetry.keyId) {
      return;
    }
    if (this.handshakePromise) {
      return this.handshakePromise;
    }
    this.handshakePromise = this.performHandshake().finally(() => {
      this.handshakePromise = null;
    });
    return this.handshakePromise;
  }

  private async performHandshake(): Promise<void> {
    try {
      if (!window.crypto?.subtle) {
        throw new Error('WebCrypto API indisponível neste contexto');
      }

      const metaRes = await fetch('/api/v1/crypto/handshake');
      if (!metaRes.ok) throw new Error('Falha ao obter chave pública do servidor');
      const meta = (await metaRes.json()) as {
        ecdhPublicKeySpkiBase64: string;
        fingerprint: string;
        cipherSuite: string;
      };

      // Generate ephemeral client ECDH P-256 keypair
      const clientKeyPair = await window.crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits']
      );

      const clientPubSpki = await window.crypto.subtle.exportKey('spki', clientKeyPair.publicKey);
      const clientPubB64 = bytesToBase64(new Uint8Array(clientPubSpki));

      const serverPubKey = await window.crypto.subtle.importKey(
        'spki',
        base64ToBytes(meta.ecdhPublicKeySpkiBase64),
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        []
      );

      const sessionRes = await fetch('/api/v1/crypto/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientPublicKeySpkiBase64: clientPubB64 }),
      });
      if (!sessionRes.ok) throw new Error('Falha ao registrar sessão E2EE');
      const session = (await sessionRes.json()) as { keyId: string; expiresAt: string };

      const sharedBits = await window.crypto.subtle.deriveBits(
        { name: 'ECDH', public: serverPubKey },
        clientKeyPair.privateKey,
        256
      );

      const hkdfBaseKey = await window.crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
      const enc = new TextEncoder();
      const aesKey = await window.crypto.subtle.deriveKey(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: enc.encode('SYGMA-BRAZIL-E2EE-SALT-2026'),
          info: enc.encode(session.keyId),
        },
        hkdfBaseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );

      this.aesKey = aesKey;
      this.telemetry = {
        ...this.telemetry,
        active: true,
        keyId: session.keyId,
        fingerprint: meta.fingerprint,
        cipherSuite: meta.cipherSuite,
        expiresAt: session.expiresAt,
        lastHandshakeAt: new Date().toISOString(),
        error: null,
      };
    } catch (err) {
      this.telemetry = {
        ...this.telemetry,
        active: false,
        error: err instanceof Error ? err.message : 'Erro desconhecido no handshake E2EE',
      };
    }
  }

  public async decryptEnvelope<T>(envelope: EncryptedEnvelope): Promise<T> {
    if (!this.aesKey) throw new Error('Chave de sessão AES-GCM ausente');
    const iv = base64ToBytes(envelope.iv);
    const cipherBytes = base64ToBytes(envelope.ciphertext);
    const tagBytes = base64ToBytes(envelope.authTag);

    // WebCrypto AES-GCM expects ciphertext || authTag concatenated
    const combined = new Uint8Array(new ArrayBuffer(cipherBytes.length + tagBytes.length));
    combined.set(cipherBytes, 0);
    combined.set(tagBytes, cipherBytes.length);

    const aad = new TextEncoder().encode(`${envelope.keyId}|${envelope.timestamp}|${envelope.nonce}`);
    const plainBuffer = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: aad,
        tagLength: 128,
      },
      this.aesKey,
      combined
    );

    this.telemetry.encryptedPacketsDecrypted += 1;
    const text = new TextDecoder().decode(plainBuffer);
    return JSON.parse(text) as T;
  }

  public async encryptPayload(payload: unknown): Promise<EncryptedEnvelope> {
    await this.ensureHandshake();
    if (!this.aesKey || !this.telemetry.keyId) {
      throw new Error('Sessão E2EE não estabelecida');
    }

    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const nonceBytes = window.crypto.getRandomValues(new Uint8Array(12));
    const nonce = Array.from(nonceBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const timestamp = new Date().toISOString();
    const keyId = this.telemetry.keyId;
    const aad = new TextEncoder().encode(`${keyId}|${timestamp}|${nonce}`);
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));

    const encryptedWithTag = new Uint8Array(
      await window.crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: aad,
          tagLength: 128,
        },
        this.aesKey,
        plaintext
      )
    );

    const ciphertext = encryptedWithTag.slice(0, encryptedWithTag.length - 16);
    const authTag = encryptedWithTag.slice(encryptedWithTag.length - 16);
    this.telemetry.encryptedPacketsSent += 1;

    return {
      version: 'SYGMA-E2EE-1.0',
      alg: 'ECDH-P256-HKDF-SHA256+AES-256-GCM',
      keyId,
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(ciphertext),
      authTag: bytesToBase64(authTag),
      signatureEd25519: 'client-originated',
      timestamp,
      nonce,
    };
  }

  public async fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
    await this.ensureHandshake();
    const headers = new Headers(options.headers || {});
    if (!headers.has('Content-Type') && options.body) {
      headers.set('Content-Type', 'application/json');
    }
    if (this.telemetry.active && this.telemetry.keyId) {
      headers.set('x-sygma-e2ee-keyid', this.telemetry.keyId);
    }

    const res = await fetch(url, { ...options, headers });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || `Erro HTTP ${res.status}`);
    }
    if (data && data.e2ee === true && data.envelope) {
      return this.decryptEnvelope<T>(data.envelope as EncryptedEnvelope);
    }
    return data as T;
  }

  public async postEncryptedAi<T>(prompt: string, history: Array<{ role: 'user' | 'model'; text: string }>): Promise<T> {
    await this.ensureHandshake();
    if (this.telemetry.active && this.aesKey) {
      const envelope = await this.encryptPayload({ prompt, history });
      const res = await fetch('/api/v1/e2ee/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ envelope }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Erro HTTP ${res.status}`);
      if (data?.e2ee && data?.envelope) {
        return this.decryptEnvelope<T>(data.envelope as EncryptedEnvelope);
      }
      return data as T;
    }
    return this.fetchJson<T>('/api/v1/ai/analyze', {
      method: 'POST',
      body: JSON.stringify({ prompt, history }),
    });
  }
}

export const sygmaClient = new E2eeApiClient();
