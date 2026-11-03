import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const value = (process.env.XY_CLOUD_ORIGIN ?? '').trim();
if (value) {
  const address = new URL(value);
  if (
    address.protocol !== 'https:' ||
    address.username ||
    address.password ||
    address.pathname !== '/' ||
    address.search ||
    address.hash
  )
    throw new Error('XY_CLOUD_ORIGIN must be an origin-only HTTPS URL');
}
await writeFile(
  resolve('electron/cloud-defaults.json'),
  `${JSON.stringify({ origin: value }, null, 2)}\n`,
);
console.log(
  `Windows collector default origin: ${value || '(not set; enter it in the setup window)'}`,
);
