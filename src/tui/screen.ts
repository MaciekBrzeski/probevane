// The terminal cell surface + ANSI codec now lives in @facet/render-term (the
// shared drawing engine). This module re-exports it so probevane's panes keep
// importing `./screen.js` unchanged. `Style` is the engine's `CellStyle`.
export {
  blank, putText, fillRect, box, serialize, diff, styleSgr,
  type Screen, type Cell, type CellStyle as Style,
} from '@facet/render-term';
