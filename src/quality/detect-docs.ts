import { Node } from 'ts-morph';
import { detectProject, docCarrier, fnName, isFnLike, isReportable } from './analyze-detect.js';

// Doc-comment TEXT extraction — the input for function-level similarity
// (`search --similar --fns`). Lives beside the boolean doc gate but in its own
// file: the analyzer only needs "has a doc?", similarity needs what it SAYS.

/** Raw leading comment(s) → plain prose: comment markers, leading `*` gutters and
 *  whitespace runs collapsed, so embeddings compare what the doc SAYS, not how
 *  it's fenced. */
function stripCommentMarkers(raw: string): string {
  return raw
    .replace(/\/\*\*?|\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/^\s*(\*|\/\/)\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Comment source for doc-TEXT extraction. Members of an object literal or
 *  class must use their OWN leading comment (property assignment / method node)
 *  — walking to the outer statement would hand every sibling method the same
 *  container header, and identical texts would flood similarity ranking with
 *  meaningless same-object pairs. Standalone fns use the docCarrier rule. */
function docTextNode(n: Node): Node {
  const inContainer = n
    .getAncestors()
    .some((a) => Node.isObjectLiteralExpression(a) || Node.isClassDeclaration(a));
  if (!inContainer) return docCarrier(n);
  const p = n.getParent();
  return p && (Node.isPropertyAssignment(p) || Node.isPropertyDeclaration(p)) ? p : n;
}

/** One documented top-level function: where it is and what its doc SAYS.
 *  Produced by detectFunctionDocs; embedded by search --similar --fns. */
export interface FnDoc {
  name: string;
  startLine: number;
  doc: string; // marker-stripped prose of the leading comment(s)
}

/** Extract every top-level function's doc-comment text. Nested functions and
 *  undocumented functions are skipped (mirrors the doc-comment rule's scope) —
 *  the output feeds doc-similarity ranking, where "no doc" has nothing to say. */
export function detectFunctionDocs(source: string): FnDoc[] {
  const sf = detectProject.createSourceFile('__detect_docs__.tsx', source, { overwrite: true });
  const out: FnDoc[] = [];
  sf.forEachDescendant((node) => {
    if (!isFnLike(node) || !isReportable(node)) return;
    if (node.getAncestors().some(isFnLike)) return; // nested — parent's doc covers it
    const doc = stripCommentMarkers(
      docTextNode(node).getLeadingCommentRanges().map((r) => r.getText()).join('\n'),
    );
    if (doc) out.push({ name: fnName(node), startLine: node.getStartLineNumber(), doc });
  });
  return out;
}
