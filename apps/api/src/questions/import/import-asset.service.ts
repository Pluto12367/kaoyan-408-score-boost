import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportStorageService } from './import-storage.service';

const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Map<string, Buffer>([
  ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff])],
  ['image/webp', Buffer.from('RIFF')],
]);

export interface CandidateAssetUpload {
  buffer: Buffer;
  sourceRegion?: string;
}

@Injectable()
export class ImportAssetService {
  constructor(private readonly prisma: PrismaService, private readonly storage: ImportStorageService) {}

  async readForAdmin(assetId: string) {
    const asset = await this.prisma.questionImportAsset.findUnique({
      where: { id: assetId },
      select: { storageKey: true, mediaType: true, scope: true },
    });
    if (!asset) throw new NotFoundException('Question import asset was not found');
    return { ...asset, path: await this.storage.resolveAssetPath(asset.storageKey) };
  }

  async uploadCandidateAsset(candidateId: string, upload: CandidateAssetUpload) {
    const candidate = await this.prisma.questionImportCandidate.findUnique({ where: { id: candidateId }, select: { id: true, batchId: true } });
    if (!candidate) throw new NotFoundException('Question import candidate was not found');
    const { buffer } = upload;
    const mediaType = detectImageType(buffer);
    if (!mediaType) throw new BadRequestException('Only PNG, JPEG, and WebP image uploads are supported');
    if (buffer.length === 0 || buffer.length > MAX_ASSET_BYTES) throw new BadRequestException('Candidate asset exceeds the 10MB size limit');
    const sourceRegion = parseSourceRegion(upload.sourceRegion);
    const stored = await this.storage.putCandidateAsset(buffer, mediaType);
    try {
      return await this.prisma.questionImportAsset.create({
        data: {
          batchId: candidate.batchId, candidateId: candidate.id, scope: 'temporary', storageKey: stored.storageKey,
          sha256: createHash('sha256').update(buffer).digest('hex'), mediaType, byteSize: buffer.length,
          sourceRegion: sourceRegion as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (error) {
      await this.storage.removeTemporaryAsset(stored.storageKey);
      throw error;
    }
  }

  async deleteCandidateAsset(candidateId: string, assetId: string): Promise<void> {
    const asset = await this.prisma.questionImportAsset.findFirst({
      where: { id: assetId, candidateId, scope: 'temporary' }, select: { id: true, storageKey: true },
    });
    if (!asset) throw new NotFoundException('Temporary candidate asset was not found');
    await this.prisma.questionImportAsset.delete({ where: { id: asset.id } });
    await this.storage.removeTemporaryAsset(asset.storageKey);
  }

  async preparePromotions(candidateIds: string[]) {
    const assets = await this.prisma.questionImportAsset.findMany({
      where: { candidateId: { in: candidateIds }, scope: 'temporary' },
      select: { id: true, candidateId: true, batchId: true, storageKey: true, sha256: true, mediaType: true, byteSize: true, pageNumber: true, sourceRegion: true },
    });
    return Promise.all(assets.map(async (asset) => ({ ...asset, permanentStorageKey: await this.storage.copyToPermanent(asset.storageKey, asset.sha256, asset.mediaType) })));
  }
}

function detectImageType(buffer: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | undefined {
  if (buffer.length < 3) return undefined;
  for (const [mediaType, signature] of IMAGE_TYPES) {
    if (buffer.subarray(0, signature.length).equals(signature)) {
      if (mediaType !== 'image/webp' || (buffer.length >= 12 && buffer.subarray(8, 12).toString('ascii') === 'WEBP')) return mediaType as 'image/png' | 'image/jpeg' | 'image/webp';
    }
  }
  return undefined;
}

function parseSourceRegion(value: string | undefined) {
  if (value === undefined || value === '') return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new BadRequestException('sourceRegion must be JSON crop coordinates'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new BadRequestException('sourceRegion must be crop coordinates');
  const region = parsed as Record<string, unknown>;
  for (const key of ['x', 'y', 'width', 'height']) {
    if (typeof region[key] !== 'number' || !Number.isFinite(region[key]) || region[key] < 0) throw new BadRequestException('sourceRegion must contain non-negative crop coordinates');
  }
  if (region.width === 0 || region.height === 0) throw new BadRequestException('sourceRegion crop dimensions must be positive');
  return region;
}
