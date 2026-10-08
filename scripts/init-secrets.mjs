import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
mkdirSync('.secrets', { recursive: true, mode: 0o700 });
chmodSync('.secrets', 0o700);
for (const [filename, bytes, encoding] of [
  ['api-token', 36, 'base64url'],
  ['vnc-password', 4, 'hex'],
]) {
  const pathname = `.secrets/${filename}`;
  if (!existsSync(pathname))
    writeFileSync(pathname, `${randomBytes(bytes).toString(encoding)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
  chmodSync(pathname, 0o600);
}
console.log('Private service credentials ready. Existing credentials were retained.');
