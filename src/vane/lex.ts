import type { Pos, VaneError } from './ast.js';

// Vane lexer — physical lines → logical lines with measured indentation.
// Vane is line-oriented on purpose (repo culture: regex parsers, no grammar
// deps): every construct fits one line except guidance blocks, which the
// parser reassembles from deeper-indented lines.

/** One meaningful line: its indent depth (spaces), text (indent stripped),
 *  and 1-based source line for error positions. */
export interface LexLine {
  indent: number;
  text: string;
  line: number;
}

/** Split source into meaningful lines, dropping blanks and full-line `#`
 *  comments. Tabs are a hard error — indentation is structure here, and mixed
 *  tabs/spaces is the classic silent-corruption path. */
export function lex(source: string, file: string): { lines: LexLine[]; errors: VaneError[] } {
  const lines: LexLine[] = [];
  const errors: VaneError[] = [];
  source.split('\n').forEach((raw, i) => {
    const pos: Pos = { file, line: i + 1 };
    if (/^\s*$/.test(raw)) return;
    const indentText = raw.match(/^[ \t]*/)![0];
    if (indentText.includes('\t')) {
      errors.push({ message: 'tab in indentation — vane uses 2-space indents only', pos });
      return;
    }
    const text = raw.slice(indentText.length);
    if (text.startsWith('#')) return; // comment line
    lines.push({ indent: indentText.length, text, line: pos.line });
  });
  return { lines, errors };
}
