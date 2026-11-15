const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

class CredentialStoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CredentialStoreError';
  }
}

function createCredentialStore(filePath, safeStorage) {
  const requireEncryption = () => {
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
      throw new CredentialStoreError('운영체제의 보안 저장소를 사용할 수 없습니다. 기존 인증 정보는 보존됩니다. 로그인 잠금을 해제하고 다시 시도해 주세요.');
    }
  };

  const write = (credentials) => {
    requireEncryption();
    const temporaryPath = `${filePath}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
      const encrypted = safeStorage.encryptString(JSON.stringify(credentials));
      const envelope = { format: 'dotdock-encrypted-v1', data: encrypted.toString('base64') };
      fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(temporaryPath, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.renameSync(temporaryPath, filePath);
    } catch {
      fs.rmSync(temporaryPath, { force: true });
      throw new CredentialStoreError('인증 정보를 암호화하여 저장하지 못했습니다. 기존 인증 파일은 보존됩니다.');
    }
  };

  const read = () => {
    if (!fs.existsSync(filePath)) return {};
    requireEncryption();
    let credentials;
    let encrypted;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      encrypted = parsed?.format === 'dotdock-encrypted-v1';
      if (parsed?.format && !encrypted) throw new Error('Unknown credential format');
      credentials = encrypted
        ? JSON.parse(safeStorage.decryptString(Buffer.from(parsed.data, 'base64')))
        : parsed;
      if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) throw new Error('Invalid credentials');
    } catch {
      throw new CredentialStoreError('저장된 인증 정보를 읽거나 복호화하지 못했습니다. 기존 파일을 보존했으며 자동으로 덮어쓰지 않습니다.');
    }
    if (!encrypted) write(credentials);
    return credentials;
  };

  return { read, write };
}

module.exports = { createCredentialStore, CredentialStoreError };
