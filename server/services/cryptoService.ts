import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { AuditEvent, EncryptedEnvelope } from '../types/domain.ts';

interface ClientSessionKey {
  keyId: string;
  aesKey: Buffer;
  clientPublicKeyPemOrSpki: string;
  createdAt: string;
  expiresAt: number;
}

const DEFAULT_DATA_DIR = process.env.SYGMA_DATA_DIR
  ? path.resolve(process.env.SYGMA_DATA_DIR)
  : path.resolve(process.cwd(), 'data');

function atomicWriteJson(filePath: string, data: unknown) {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
}

export class CryptoMicroservice {
  private readonly dataDir: string;
  private readonly auditFile: string;
  private readonly vaultFile: string;
  private readonly vaultKeyFile: string;
  private serverEcdhKeys: crypto.KeyPairSyncResult<string, string>;
  private serverSignKeys: crypto.KeyPairSyncResult<string, string>;
  private sessions = new Map<string, ClientSessionKey>();
  private usedNonces = new Map<string, number>();
  private auditChain: AuditEvent[] = [];
  private masterKey: Buffer;

  constructor(dataDir = DEFAULT_DATA_DIR) {
    this.dataDir = dataDir;
    this.auditFile = path.join(this.dataDir, 'audit_chain.json');
    this.vaultFile = path.join(this.dataDir, 'sealed_vault.json');
    this.vaultKeyFile = path.join(this.dataDir, '.vault.key');

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // ECDH P-256 keypair compatible with Browser WebCrypto SubtleCrypto ECDH P-256
    this.serverEcdhKeys = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Ed25519 keypair for non-repudiation signatures on every encrypted envelope
    this.serverSignKeys = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Persistent vault master key: env secret or persisted 32-byte machine-local key (mode 0600)
    if (process.env.SYGMA_VAULT_SECRET) {
      this.masterKey = crypto.scryptSync(process.env.SYGMA_VAULT_SECRET, 'sygma-ais-vault-salt-v1', 32);
    } else if (fs.existsSync(this.vaultKeyFile)) {
      const hex = fs.readFileSync(this.vaultKeyFile, 'utf8').trim();
      if (/^[0-9a-f]{64}$/i.test(hex)) {
        this.masterKey = Buffer.from(hex, 'hex');
      } else {
        this.masterKey = crypto.randomBytes(32);
        fs.writeFileSync(this.vaultKeyFile, this.masterKey.toString('hex'), { mode: 0o600 });
      }
    } else {
      this.masterKey = crypto.randomBytes(32);
      fs.writeFileSync(this.vaultKeyFile, this.masterKey.toString('hex'), { mode: 0o600 });
    }

    this.loadAuditChain();
    this.recordAudit('svc-crypto-kms', 'SYSTEM', 'KMS_INITIALIZED', 'ECDH-P256+Ed25519', 'SUCCESS', {
      keyFingerprint: this.getPublicFingerprint(),
    });
  }

  public getPublicFingerprint(): string {
    return crypto
      .createHash('sha256')
      .update(this.serverEcdhKeys.publicKey + this.serverSignKeys.publicKey)
      .digest('hex')
      .slice(0, 16)
      .toUpperCase();
  }

  public getServerHandshakeMetadata() {
    const spkiDer = crypto
      .createPublicKey(this.serverEcdhKeys.publicKey)
      .export({ type: 'spki', format: 'der' });
    const edSpkiDer = crypto
      .createPublicKey(this.serverSignKeys.publicKey)
      .export({ type: 'spki', format: 'der' });

    return {
      ecdhPublicKeySpkiBase64: Buffer.from(spkiDer).toString('base64'),
      ed25519PublicKeySpkiBase64: Buffer.from(edSpkiDer).toString('base64'),
      fingerprint: this.getPublicFingerprint(),
      cipherSuite: 'ECDH-P256 + HKDF-SHA256 + AES-256-GCM + Ed25519',
    };
  }

  public establishSession(clientPublicKeySpkiBase64: string): { keyId: string; expiresAt: string } {
    const clientPubDer = Buffer.from(clientPublicKeySpkiBase64, 'base64');
    const clientPubKey = crypto.createPublicKey({
      key: clientPubDer,
      format: 'der',
      type: 'spki',
    });

    const serverPrivKey = crypto.createPrivateKey(this.serverEcdhKeys.privateKey);
    const sharedSecret = crypto.diffieHellman({
      privateKey: serverPrivKey,
      publicKey: clientPubKey,
    });

    // Derive 256-bit AES-GCM session key via HKDF-SHA256
    const keyId = `sygma-e2ee-${crypto.randomBytes(8).toString('hex')}`;
    const derived = crypto.hkdfSync(
      'sha256',
      sharedSecret,
      Buffer.from('SYGMA-BRAZIL-E2EE-SALT-2026', 'utf8'),
      Buffer.from(keyId, 'utf8'),
      32
    );

    const expiresAtMs = Date.now() + 1000 * 60 * 60 * 4; // 4h session TTL
    this.sessions.set(keyId, {
      keyId,
      aesKey: Buffer.from(derived),
      clientPublicKeyPemOrSpki: clientPublicKeySpkiBase64,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAtMs,
    });

    this.recordAudit('svc-crypto-kms', 'CLIENT_SESSION', 'E2EE_HANDSHAKE', keyId, 'SUCCESS', {
      algorithm: 'ECDH-P256-HKDF-SHA256',
    });

    return {
      keyId,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  public hasValidSession(keyId: string): boolean {
    const s = this.sessions.get(keyId);
    if (!s) return false;
    if (Date.now() > s.expiresAt) {
      this.sessions.delete(keyId);
      return false;
    }
    return true;
  }

  public encryptEnvelope(keyId: string, payload: unknown): EncryptedEnvelope {
    const session = this.sessions.get(keyId);
    if (!session || Date.now() > session.expiresAt) {
      throw new Error('E2EE session invalid or expired. Perform handshake first.');
    }

    const iv = crypto.randomBytes(12);
    const nonce = crypto.randomBytes(12).toString('hex');
    const timestamp = new Date().toISOString();
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');

    const cipher = crypto.createCipheriv('aes-256-gcm', session.aesKey, iv);
    const aad = Buffer.from(`${keyId}|${timestamp}|${nonce}`, 'utf8');
    cipher.setAAD(aad);

    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const signingInput = Buffer.concat([iv, encrypted, authTag, aad]);
    const signature = crypto.sign(null, signingInput, this.serverSignKeys.privateKey);

    return {
      version: 'SYGMA-E2EE-1.0',
      alg: 'ECDH-P256-HKDF-SHA256+AES-256-GCM',
      keyId,
      iv: iv.toString('base64'),
      ciphertext: encrypted.toString('base64'),
      authTag: authTag.toString('base64'),
      signatureEd25519: signature.toString('base64'),
      timestamp,
      nonce,
    };
  }

  public decryptEnvelope<T = unknown>(envelope: EncryptedEnvelope): T {
    const session = this.sessions.get(envelope.keyId);
    if (!session || Date.now() > session.expiresAt) {
      throw new Error('E2EE session invalid or expired.');
    }

    // Anti-replay: enforce timestamp skew window (±5 min) and unique nonce per keyId
    const envTime = Date.parse(envelope.timestamp);
    const now = Date.now();
    if (Number.isNaN(envTime) || Math.abs(now - envTime) > 5 * 60 * 1000) {
      throw new Error('Envelope E2EE expirado ou com desvio de relógio inválido.');
    }

    for (const [k, exp] of this.usedNonces.entries()) {
      if (now > exp) this.usedNonces.delete(k);
    }
    const nonceKey = `${envelope.keyId}:${envelope.nonce}`;
    if (!envelope.nonce || this.usedNonces.has(nonceKey)) {
      this.recordAudit('svc-crypto-kms', 'SECURITY', 'REPLAY_DETECTED', envelope.keyId, 'DENIED', {
        nonce: envelope.nonce,
      });
      throw new Error('Replay de envelope E2EE detectado (nonce reutilizado).');
    }

    const iv = Buffer.from(envelope.iv, 'base64');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    const authTag = Buffer.from(envelope.authTag, 'base64');
    const aad = Buffer.from(`${envelope.keyId}|${envelope.timestamp}|${envelope.nonce}`, 'utf8');

    const decipher = crypto.createDecipheriv('aes-256-gcm', session.aesKey, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    this.usedNonces.set(nonceKey, now + 10 * 60 * 1000);
    return JSON.parse(decrypted.toString('utf8')) as T;
  }

  // Seal commercial provider credentials at rest using AES-256-GCM
  public sealCredential(providerId: string, secretValue: string): { sealed: boolean; masked: string } {
    let vault: Record<string, { iv: string; data: string; tag: string; updatedAt: string }> = {};
    if (fs.existsSync(this.vaultFile)) {
      try {
        vault = JSON.parse(fs.readFileSync(this.vaultFile, 'utf8'));
      } catch {
        vault = {};
      }
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    cipher.setAAD(Buffer.from(providerId, 'utf8'));
    const enc = Buffer.concat([cipher.update(secretValue, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    vault[providerId] = {
      iv: iv.toString('base64'),
      data: enc.toString('base64'),
      tag: tag.toString('base64'),
      updatedAt: new Date().toISOString(),
    };

    atomicWriteJson(this.vaultFile, vault);
    this.recordAudit('svc-crypto-kms', 'ADMIN', 'CREDENTIAL_SEALED', providerId, 'SUCCESS', {
      cipher: 'AES-256-GCM',
    });

    const masked =
      secretValue.length > 6
        ? `${secretValue.slice(0, 3)}••••${secretValue.slice(-3)}`
        : '••••••';
    return { sealed: true, masked };
  }

  public unsealCredential(providerId: string): string | null {
    if (!fs.existsSync(this.vaultFile)) return null;
    try {
      const vault = JSON.parse(fs.readFileSync(this.vaultFile, 'utf8')) as Record<
        string,
        { iv: string; data: string; tag: string }
      >;
      const entry = vault[providerId];
      if (!entry) return null;
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, Buffer.from(entry.iv, 'base64'));
      decipher.setAAD(Buffer.from(providerId, 'utf8'));
      decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(entry.data, 'base64')),
        decipher.final(),
      ]);
      return plain.toString('utf8');
    } catch {
      return null;
    }
  }

  public hasSealedCredential(providerId: string): boolean {
    if (!fs.existsSync(this.vaultFile)) return false;
    try {
      const vault = JSON.parse(fs.readFileSync(this.vaultFile, 'utf8'));
      return Boolean(vault[providerId]);
    } catch {
      return false;
    }
  }

  private loadAuditChain() {
    if (fs.existsSync(this.auditFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.auditFile, 'utf8'));
        if (Array.isArray(parsed)) {
          this.auditChain = parsed;
        }
      } catch {
        this.auditChain = [];
      }
    }
  }

  public recordAudit(
    service: string,
    actor: string,
    action: string,
    resource: string,
    outcome: 'SUCCESS' | 'DENIED' | 'ERROR',
    metadata: Record<string, unknown> = {}
  ): AuditEvent {
    const prevHash =
      this.auditChain.length > 0
        ? this.auditChain[this.auditChain.length - 1].hash
        : '0000000000000000000000000000000000000000000000000000000000000000';
    const seq = this.auditChain.length + 1;
    const timestamp = new Date().toISOString();
    const id = `aud-${seq}-${crypto.randomBytes(4).toString('hex')}`;

    const canonical = JSON.stringify({ seq, id, timestamp, actor, service, action, resource, outcome, metadata, prevHash });
    const hash = crypto.createHash('sha256').update(canonical).digest('hex');

    const event: AuditEvent = {
      seq,
      id,
      timestamp,
      actor,
      service,
      action,
      resource,
      outcome,
      metadata,
      prevHash,
      hash,
    };

    this.auditChain.push(event);
    if (this.auditChain.length > 1000) {
      this.auditChain = this.auditChain.slice(-1000);
    }

    try {
      atomicWriteJson(this.auditFile, this.auditChain);
    } catch {
      // Non-fatal in read-only edge environments
    }
    return event;
  }

  public verifyAuditChain(): { valid: boolean; totalEvents: number; brokenAtSeq?: number } {
    for (let i = 0; i < this.auditChain.length; i++) {
      const ev = this.auditChain[i];
      if (i > 0 && ev.prevHash !== this.auditChain[i - 1].hash) {
        return { valid: false, totalEvents: this.auditChain.length, brokenAtSeq: ev.seq };
      }
      const canonical = JSON.stringify({
        seq: ev.seq,
        id: ev.id,
        timestamp: ev.timestamp,
        actor: ev.actor,
        service: ev.service,
        action: ev.action,
        resource: ev.resource,
        outcome: ev.outcome,
        metadata: ev.metadata,
        prevHash: ev.prevHash,
      });
      const expected = crypto.createHash('sha256').update(canonical).digest('hex');
      if (expected !== ev.hash) {
        return { valid: false, totalEvents: this.auditChain.length, brokenAtSeq: ev.seq };
      }
    }
    return { valid: true, totalEvents: this.auditChain.length };
  }

  public getAuditEvents(limit = 50): AuditEvent[] {
    return this.auditChain.slice(-limit).reverse();
  }

  public getAuditRootHash(): string {
    return this.auditChain.length > 0
      ? this.auditChain[this.auditChain.length - 1].hash
      : '0000000000000000000000000000000000000000000000000000000000000000';
  }

  public getActiveSessionsCount(): number {
    const now = Date.now();
    for (const [k, v] of this.sessions.entries()) {
      if (now > v.expiresAt) this.sessions.delete(k);
    }
    return this.sessions.size;
  }
}

export const cryptoService = new CryptoMicroservice();
