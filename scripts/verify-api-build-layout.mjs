import { constants } from 'node:fs';
import { access } from 'node:fs/promises';

const entrypoint = new URL('../apps/api/dist/main.js', import.meta.url);

await access(entrypoint, constants.R_OK);
console.log('API build entrypoint verified: apps/api/dist/main.js');
