// @facet/render-term — CellPainter (terminal backend) + the cell surface/codec.
export { CellPainter } from './cell-painter';
export { Braille } from './braille';
export {
  blank, putText, fillRect, box, blit, serialize, diff, styleSgr,
  type Screen, type Cell, type CellStyle,
} from './screen';
