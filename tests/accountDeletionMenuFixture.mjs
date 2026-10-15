import { readFile } from 'node:fs/promises';
// Existing VM menu tests still run the real deletion view. Network-bound functions
// are only needed by the dedicated service/dialog tests.
const strip = source => source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
export const menuCodeWithDeletion = 'const ACCOUNT_SWITCHING_ENABLED = false;\n' + strip(await readFile(new URL('../js/accountDeletionView.js',import.meta.url),'utf8'))
  + '\n' + strip(await readFile(new URL('../js/commonMenu.js',import.meta.url),'utf8'));
