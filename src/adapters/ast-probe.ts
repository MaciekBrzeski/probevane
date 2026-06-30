import { Project, ts, Node, type SourceFile } from 'ts-morph';

// Accurate export/prop extraction via the TypeScript AST (ts-morph). Shared by
// the React and Vue adapters. Returns null on any parse failure so the caller
// can fall back to the regex probe — the AST is a precision upgrade, not a
// hard dependency.

export interface AstExport {
  name: string;
  isComponent: boolean;
  signature?: string;
}
export interface AstFacts {
  exports: AstExport[];
  props: string[];
}

function createProbeFile(src: string, fileName: string): SourceFile {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      allowJs: true,
      jsx: ts.JsxEmit.Preserve,
      skipLibCheck: true,
      noResolve: true,
      target: ts.ScriptTarget.ES2020,
    },
  });
  return project.createSourceFile(fileName, src, { overwrite: true });
}

function classifyExport(name: string, d: Node | undefined, isTsx: boolean): AstExport | null {
  // Skip type-only exports (interface / type alias / enum) — not testable units.
  if (d && (Node.isInterfaceDeclaration(d) || Node.isTypeAliasDeclaration(d) || Node.isEnumDeclaration(d))) return null;
  // A PascalCase export in a .tsx file that's a function/arrow is a component.
  const isComponent = !!d && isTsx && /^[A-Z]/.test(name) && isFunctionLike(d);
  return { name, isComponent, signature: d ? signatureOf(name, d) : undefined };
}

function collectExports(sf: SourceFile, isTsx: boolean): AstExport[] {
  const exports: AstExport[] = [];
  const seen = new Set<string>();
  for (const [name, decls] of sf.getExportedDeclarations()) {
    const e = classifyExport(name, decls[0], isTsx);
    if (!e || !name || seen.has(name)) continue;
    seen.add(name);
    exports.push(e);
  }
  return exports;
}

export function astExtract(src: string, fileName = 'probe.tsx'): AstFacts | null {
  try {
    const sf = createProbeFile(src, fileName);
    const isTsx = /\.[jt]sx$/.test(fileName);
    const exports = collectExports(sf, isTsx);
    const props = extractProps(sf);
    return { exports, props };
  } catch {
    return null;
  }
}

function isFunctionLike(d: Node): boolean {
  if (Node.isFunctionDeclaration(d)) return true;
  if (Node.isVariableDeclaration(d)) {
    const init = d.getInitializer();
    return !!init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init));
  }
  return false;
}

function signatureOf(name: string, d: Node): string | undefined {
  // Function declaration
  if (Node.isFunctionDeclaration(d) || Node.isMethodDeclaration(d)) return fnSig(name, d as any);
  // const NAME = (..) => ..  /  function expr
  if (Node.isVariableDeclaration(d)) {
    const init = d.getInitializer();
    if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) return fnSig(name, init as any);
    // const NAME = createSlice({...}) etc — show the call/identifier
    const kind = init ? init.getKindName().replace(/Expression$/, '') : 'value';
    return `${name} (${kind})`;
  }
  if (name === 'default') return 'default';
  return name;
}

function fnSig(name: string, fn: { getParameters(): any[]; isAsync?(): boolean; getReturnTypeNode?(): any }): string {
  const params = fn
    .getParameters()
    .map((p: any) => {
      const t = p.getTypeNode?.()?.getText();
      return t ? `${p.getName()}: ${t}` : p.getName();
    })
    .join(', ');
  const ret = fn.getReturnTypeNode?.()?.getText();
  const asyncPrefix = fn.isAsync?.() ? 'async ' : '';
  return `${asyncPrefix}${name}(${params})${ret ? `: ${ret}` : ''}`;
}

function extractProps(sf: SourceFile): string[] {
  const out: string[] = [];
  for (const iface of sf.getInterfaces()) {
    const n = iface.getName();
    if (!/Props?$/.test(n)) continue;
    const fields = iface
      .getProperties()
      .map((p) => `${p.getName()}${p.hasQuestionToken() ? '?' : ''}: ${p.getTypeNode()?.getText() ?? 'any'}`)
      .join(', ');
    out.push(`${n} { ${fields} }`);
  }
  // type Props = { ... }
  for (const ta of sf.getTypeAliases()) {
    const n = ta.getName();
    if (!/Props?$/.test(n)) continue;
    out.push(`${n} ${ta.getTypeNode()?.getText() ?? ''}`.trim());
  }
  return out;
}
