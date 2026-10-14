const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
// Small project-local loader for tests/CLI; application code remains typechecked by tsc.
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  module._compile(output, filename);
};
module.exports = file => require(path.resolve(__dirname, '..', file));
