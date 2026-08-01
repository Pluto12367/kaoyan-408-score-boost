export interface SourceRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DocumentBlock =
  | { kind: 'text'; text: string; region: SourceRegion; confidence?: number }
  | { kind: 'formula'; latex: string; region: SourceRegion; confidence?: number }
  | { kind: 'image'; providerAssetId: string; region: SourceRegion }
  | { kind: 'table'; html: string; region: SourceRegion };

export interface ParsedPage {
  pageNumber: number;
  width: number;
  height: number;
  blocks: DocumentBlock[];
  quality: { score: number; signals: string[] };
}

export interface ParsedDocument {
  provider: 'mineru' | 'tencent-ocr';
  model: string;
  pages: ParsedPage[];
  rawResultKey?: string;
}
