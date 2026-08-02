import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { ocr } from 'tencentcloud-sdk-nodejs-ocr';
import type { DocumentBlock, ParsedPage, SourceRegion } from '../document-blocks';
import { ImportQualityService } from '../import-quality.service';

interface TencentOcrClient {
  GeneralBasicOCR(request: { ImageBase64: string }): Promise<{ TextDetections?: Array<{ DetectedText?: string; Confidence?: number; Polygon?: Array<{ X?: number; Y?: number }> }> }>;
}

export interface TencentPageOcrProviderOptions {
  createClient?: (secretId: string, secretKey: string, region: string) => TencentOcrClient;
  readPage?: (path: string) => Promise<Buffer>;
}

@Injectable()
export class TencentPageOcrProvider {
  private readonly createClient: (secretId: string, secretKey: string, region: string) => TencentOcrClient;
  private readonly readPage: (path: string) => Promise<Buffer>;

  constructor(
    private readonly secretId = process.env.TENCENTCLOUD_SECRET_ID,
    private readonly secretKey = process.env.TENCENTCLOUD_SECRET_KEY,
    private readonly region = process.env.TENCENTCLOUD_REGION ?? 'ap-shanghai',
    options: TencentPageOcrProviderOptions = {},
    private readonly quality = new ImportQualityService(),
  ) {
    this.createClient = options.createClient ?? ((id, key, location) => new ocr.v20181119.Client({ credential: { secretId: id, secretKey: key }, region: location }) as unknown as TencentOcrClient);
    this.readPage = options.readPage ?? readFile;
  }

  isConfigured(): boolean { return Boolean(this.secretId && this.secretKey); }

  async recognize(pagePath: string, pageNumber: number, width: number, height: number): Promise<ParsedPage> {
    if (!this.isConfigured()) throw new Error('TENCENT_OCR_NOT_CONFIGURED');
    const result = await this.createClient(this.secretId!, this.secretKey!, this.region).GeneralBasicOCR({
      ImageBase64: (await this.readPage(pagePath)).toString('base64'),
    });
    const blocks = (result.TextDetections ?? []).flatMap((item) => item.DetectedText?.trim() ? [{
      kind: 'text' as const, text: item.DetectedText.trim(), confidence: item.Confidence === undefined ? undefined : item.Confidence / 100,
      region: polygonRegion(item.Polygon ?? [], width, height),
    }] : []);
    return { pageNumber, width, height, blocks, quality: this.quality.assess(blocks) };
  }
}

function polygonRegion(points: Array<{ X?: number; Y?: number }>, width: number, height: number): SourceRegion {
  const xs = points.map((point) => point.X).filter((value): value is number => typeof value === 'number');
  const ys = points.map((point) => point.Y).filter((value): value is number => typeof value === 'number');
  if (!xs.length || !ys.length || width <= 0 || height <= 0) return { x: 0, y: 0, width: 1, height: 1 };
  const left = Math.min(...xs); const top = Math.min(...ys);
  return { x: clamp(left / width), y: clamp(top / height), width: clamp((Math.max(...xs) - left) / width), height: clamp((Math.max(...ys) - top) / height) };
}

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
