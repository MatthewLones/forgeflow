/** JSON schemas for structured skill blocks stored as ```forgeflow:TYPE fenced code blocks. */

export type SkillBlockType = 'output' | 'input';

export interface InputFile {
  name: string;
  format: string;
  required: boolean;
  description: string;
}

export interface InputBlock {
  files: InputFile[];
}

export type SkillBlockData = InputBlock;

/** A parsed skill block with its position in the source document. */
export interface ParsedSkillBlock {
  type: SkillBlockType;
  data: SkillBlockData;
  raw: string;
  /** Character offset of the opening ``` in the source. */
  from: number;
  /** Character offset just past the closing ``` in the source. */
  to: number;
}

/** A suggestion from auto-detect to convert plain markdown into a forgeflow block. */
export interface ConvertibleSection {
  type: SkillBlockType;
  /** Character offset of the section start. */
  from: number;
  /** Character offset of the section end. */
  to: number;
  /** The original markdown text. */
  original: string;
  /** The suggested forgeflow block replacement. */
  replacement: string;
}
