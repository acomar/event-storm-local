import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const moduleNames = Object.freeze(['http-request.js', 'domain.js', 'ui.js', 'facilitator.js', 'ai-facilitator.js', 'version-control.js', 'canvas.js', 'app.js']);
const expectedExports = {
  'http-request.js': ['httpPresets', 'newHTTPRequest', 'normalizeHTTPRequest', 'normalizeAIHTTP', 'readHTTPPath', 'normalizeHTTPWireRequest', 'buildHTTPRequest', 'extractHTTPResponse', 'executeHTTPWireRequest', 'executeHTTPRequest'],
  'domain.js': ['kinds', 'statuses', 'relations', 'origins', 'connectionSides', 'contextDimensions', 'limits', 'uid', 'now', 'newCard', 'newProject', 'validateProject', 'importProject', 'exampleProject'],
  'ui.js': ['esc', 'icon', 'button', 'iconButton', 'logo', 'date', 'options', 'download'],
  'facilitator.js': ['questions', 'nextQuestion', 'extractContent', 'answerQuestion', 'inspectProject', 'exportBlueprint'],
  'ai-facilitator.js': ['facilitatorSystemPrompt', 'responseSchema', 'buildMessages', 'parseFacilitatorResponse', 'applyFacilitatorPlan', 'conversationFromProject'],
  'version-control.js': ['VersionError', 'canonicalJSON', 'hash', 'validateProject', 'migrateProject', 'semanticDiff', 'threeWayMerge', 'LocalStore', 'MemoryRepositoryAdapter', 'verifyObject', 'VersionEngine', 'FolderRepositoryAdapter'],
  'canvas.js': ['Board', 'normalizeContextSize', 'nodeBounds', 'edgeAnchors', 'edgeCurve'],
  'app.js': []
};

function checkSyntax(source, label, module = false) {
  const result = spawnSync(process.execPath, module ? ['--input-type=module', '--check'] : ['--check'], { input: source, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`JavaScript inválido em ${label}: ${result.stderr.trim()}`);
}

/**
 * Narrow compiler for this audited module graph, not a general-purpose bundler.
 * Only static, single-line named imports and column-zero named const/function/class
 * exports are accepted. Mutable exports, re-exports, dynamic imports and cycles fail.
 * Native Node syntax checks validate every input and the isolated output closures.
 */
export function compileModules(sources, { entry = 'app.js', runEntry = true, exposeModules = false } = {}) {
  const modules = new Map();
  for (const name of moduleNames) {
    const source = sources[name];
    if (typeof source !== 'string') throw new Error(`Módulo obrigatório ausente: ${name}`);
    checkSyntax(source, name, true);
    if (/\bimport\s*\(/.test(source) || /\bimport\s*\.\s*meta\b/.test(source)) throw new Error(`Importação dinâmica/import.meta não suportada: ${name}`);
    const imports = [];
    let body = source.replace(/^import\s+\{([^{}\r\n]+)\}\s+from\s+(['"])([^'"\r\n]+)\2;\s*$/gm, (_statement, names, _quote, path) => {
      if (!/^\.\/[a-z-]+\.js$/.test(path) || !moduleNames.includes(path.slice(2))) throw new Error(`Importação externa/desconhecida em ${name}: ${path}`);
      const bindings = names.split(',').map(item => item.trim()).map(item => {
        const match = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(item);
        if (!match) throw new Error(`Importação nomeada não suportada em ${name}: ${item}`);
        return { imported: match[1], local: match[2] || match[1] };
      });
      imports.push({ dependency: path.slice(2), bindings });
      return '';
    });
    if (/^\s*import\b/m.test(body)) throw new Error(`Declaração de importação não suportada em ${name}`);
    const exports = [];
    body = body.replace(/^export\s+((?:async\s+)?function|class|const)\s+([A-Za-z_$][\w$]*)\b/gm, (_statement, declaration, identifier) => {
      exports.push(identifier);
      return `${declaration} ${identifier}`;
    });
    if (/^\s*export\b/m.test(body)) throw new Error(`Declaração de exportação não suportada em ${name}`);
    if (new Set(exports).size !== exports.length || [...exports].sort().join(',') !== [...expectedExports[name]].sort().join(',')) throw new Error(`Contrato de exports mudou em ${name}; revise o compilador antes de gerar.`);
    if (name === 'app.js') {
      // The standalone contains its complete shell. Never fetch an external worker.
      const marker = "'serviceWorker' in navigator";
      if (body.split(marker).length !== 2) throw new Error('Registro de service worker mudou; revise o modo standalone.');
      body = body.replace(marker, "location.protocol!=='file:' && !globalThis.__EVENT_STORM_STANDALONE__ && 'serviceWorker' in navigator");
    }
    modules.set(name, { imports, exports, body });
  }
  for (const [name, module] of modules) {
    for (const { dependency, bindings } of module.imports) {
      for (const { imported } of bindings) if (!modules.get(dependency).exports.includes(imported)) throw new Error(`Export ${imported} ausente em ${dependency}, usado por ${name}`);
    }
  }
  const visiting = new Set(), visited = new Set(), order = [];
  const visit = name => {
    if (visiting.has(name)) throw new Error(`Ciclo de módulos não suportado: ${name}`);
    if (visited.has(name)) return;
    visiting.add(name);
    for (const { dependency } of modules.get(name).imports) visit(dependency);
    visiting.delete(name); visited.add(name); order.push(name);
  };
  for (const name of moduleNames) visit(name);
  if (!modules.has(entry)) throw new Error('Entrypoint desconhecido.');
  const parts = ["(() => {\n'use strict';\nglobalThis.__EVENT_STORM_STANDALONE__ = true;\nconst modules = Object.create(null);"];
  for (const name of order) {
    if (!runEntry && name === entry) continue;
    const module = modules.get(name);
    const declarations = module.imports.map(({ dependency, bindings }) => `const { ${bindings.map(({ imported, local }) => imported === local ? imported : `${imported}: ${local}`).join(', ')} } = modules[${JSON.stringify(dependency)}];`).join('\n');
    parts.push(`// Source: js/${name}\nmodules[${JSON.stringify(name)}] = (() => {\n'use strict';\n${declarations}\n${module.body}\nreturn Object.freeze({ ${module.exports.join(', ')} });\n})();`);
  }
  if (exposeModules) parts.push('globalThis.__standaloneTestModules = modules;');
  parts.push('})();\n');
  const bundle = parts.join('\n');
  checkSyntax(bundle, 'standalone bundle');
  return { bundle, order };
}

export async function readSources(root = defaultRoot) {
  return Object.fromEntries(await Promise.all(moduleNames.map(async name => [name, (await readFile(resolve(root, 'js', name), 'utf8')).replace(/\r\n?/g, '\n')])));
}

export async function buildStandalone({ root = defaultRoot, write = true } = {}) {
  const sources = await readSources(root);
  const { bundle, order } = compileModules(sources);
  const [template, css, icon] = await Promise.all(['index.html', 'styles.css', 'icon.svg'].map(async name => (await readFile(resolve(root, name), 'utf8')).replace(/\r\n?/g, '\n')));
  if (/<\/script\b/i.test(bundle) || /<\/style\b/i.test(css)) throw new Error('Fechamento HTML em conteúdo inline requer revisão antes de empacotar.');
  let html = template;
  const replaceOnce = (pattern, replacement, label) => {
    const matches = [...html.matchAll(pattern)];
    if (matches.length !== 1) throw new Error(`Template mudou: ${label}`);
    html = html.replace(pattern, () => replacement);
  };
  replaceOnce(/<link\s+rel="icon"\s+href="\.\/icon\.svg"\s+type="image\/svg\+xml">/g, `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(icon)}" type="image/svg+xml">`, 'ícone');
  replaceOnce(/\s*<link\s+rel="manifest"\s+href="\.\/manifest\.webmanifest">/g, '', 'manifest');
  replaceOnce(/<link\s+rel="stylesheet"\s+href="\.\/styles\.css">/g, `<style>\n${css}\n</style>`, 'CSS');
  replaceOnce(/\s*<script\s+type="module"\s+src="\.\/js\/app\.js"><\/script>/g, '', 'entrypoint');
  const sourceHash = createHash('sha256').update(JSON.stringify(sources)).update(css).update(icon).update(template).digest('hex');
  replaceOnce(/<\/body>/g, `<script>\n${bundle}</script>\n</body>`, 'body');
  html = html.replace('<!doctype html>', `<!doctype html>\n<!-- Generated by scripts/build-standalone.mjs. Source SHA-256: ${sourceHash}. Edit the modular sources and regenerate. -->`);
  if (write) await writeFile(resolve(root, 'standalone.html'), html, 'utf8');
  return { html, bundle, order, sourceHash };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildStandalone();
  console.log(`standalone.html gerado com ${result.order.length} módulos locais, CSS e ícone inline; sem assets externos.`);
}
