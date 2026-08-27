import { FileProgressDetail, ProgressUpdate, PublicFileItem } from './types';

interface ByteSample {
  timestamp: number;
  totalBytes: number;
}

export class ProgressTracker {
  private transferId: string;
  private totalBytes: number;
  private totalFiles: number;
  private currentFileIndex: number = 0;
  private currentFileId: string = '';
  private currentFileName: string = '';
  private currentFileTotalBytes: number = 0;
  private currentFileBytesTransferred: number = 0;
  private totalBytesTransferred: number = 0;

  private fileDetails: FileProgressDetail[] = [];
  private samples: ByteSample[] = [];
  private readonly sampleWindowMs = 1500; // 1.5s rolling average
  private smoothedSpeedBps: number = 0;

  constructor(transferId: string, totalBytes: number, totalFiles: number, files: PublicFileItem[] = []) {
    this.transferId = transferId;
    this.totalBytes = totalBytes;
    this.totalFiles = totalFiles;

    this.fileDetails = files.map((f) => ({
      id: f.id,
      name: f.name,
      relativePath: f.relativePath,
      size: f.size,
      status: 'pending',
      bytesTransferred: 0,
      percentage: 0
    }));

    this.recordSample(0);
  }

  public startFile(index: number, id: string, name: string, size: number): void {
    this.currentFileIndex = index;
    this.currentFileId = id;
    this.currentFileName = name;
    this.currentFileTotalBytes = size;
    this.currentFileBytesTransferred = 0;

    const detail = this.fileDetails.find(f => f.id === id);
    if (detail) {
      detail.status = 'transferring';
    }
  }

  public recordBytes(chunkBytes: number): ProgressUpdate {
    this.currentFileBytesTransferred += chunkBytes;
    this.totalBytesTransferred += chunkBytes;

    if (this.totalBytesTransferred > this.totalBytes) {
      this.totalBytesTransferred = this.totalBytes;
    }

    const detail = this.fileDetails.find(f => f.id === this.currentFileId);
    if (detail) {
      detail.bytesTransferred = Math.min(detail.size, this.currentFileBytesTransferred);
      detail.percentage = detail.size > 0 ? Math.min(100, Math.round((detail.bytesTransferred / detail.size) * 1000) / 10) : 100;
    }

    const now = Date.now();
    this.recordSample(this.totalBytesTransferred, now);
    this.updateSpeed(now);

    return this.getProgress();
  }

  public finishCurrentFile(): void {
    const detail = this.fileDetails.find(f => f.id === this.currentFileId);
    if (detail && detail.status !== 'skipped') {
      detail.status = 'completed';
      detail.bytesTransferred = detail.size;
      detail.percentage = 100;
    }
  }

  public skipFile(fileId: string): ProgressUpdate {
    const detail = this.fileDetails.find(f => f.id === fileId);
    if (detail) {
      detail.status = 'skipped';
      // Adjust transferred bytes accounting for skipped file
      const unTransferred = detail.size - detail.bytesTransferred;
      this.totalBytesTransferred += unTransferred;
    }
    return this.getProgress();
  }

  private recordSample(bytes: number, now: number = Date.now()): void {
    this.samples.push({ timestamp: now, totalBytes: bytes });
    const cutoff = now - this.sampleWindowMs;
    this.samples = this.samples.filter(s => s.timestamp >= cutoff);
  }

  private updateSpeed(now: number): void {
    if (this.samples.length < 2) {
      return;
    }

    const oldest = this.samples[0];
    const newest = this.samples[this.samples.length - 1];
    const durationSec = (newest.timestamp - oldest.timestamp) / 1000;

    if (durationSec > 0.1) {
      const bytesInWindow = newest.totalBytes - oldest.totalBytes;
      const currentSpeed = bytesInWindow / durationSec;

      if (this.smoothedSpeedBps === 0) {
        this.smoothedSpeedBps = currentSpeed;
      } else {
        // Exponential moving average for smooth UI rendering
        this.smoothedSpeedBps = this.smoothedSpeedBps * 0.7 + currentSpeed * 0.3;
      }
    }
  }

  public getProgress(): ProgressUpdate {
    const remainingBytes = Math.max(0, this.totalBytes - this.totalBytesTransferred);
    const speed = Math.max(0, Math.round(this.smoothedSpeedBps));
    const etaSeconds = speed > 0 ? Math.ceil(remainingBytes / speed) : 0;
    const percentage =
      this.totalBytes > 0
        ? Math.min(100, Math.round((this.totalBytesTransferred / this.totalBytes) * 1000) / 10)
        : 100;

    return {
      transferId: this.transferId,
      currentFileId: this.currentFileId,
      currentFileName: this.currentFileName,
      currentFileIndex: this.currentFileIndex,
      totalFiles: this.totalFiles,
      currentFileBytesTransferred: this.currentFileBytesTransferred,
      currentFileTotalBytes: this.currentFileTotalBytes,
      totalBytesTransferred: this.totalBytesTransferred,
      totalBytes: this.totalBytes,
      speedBps: speed,
      etaSeconds,
      percentage,
      fileDetails: this.fileDetails.map(f => ({ ...f }))
    };
  }

  public complete(): ProgressUpdate {
    this.totalBytesTransferred = this.totalBytes;
    this.currentFileBytesTransferred = this.currentFileTotalBytes;
    this.smoothedSpeedBps = 0;
    for (const f of this.fileDetails) {
      if (f.status === 'pending' || f.status === 'transferring') {
        f.status = 'completed';
        f.bytesTransferred = f.size;
        f.percentage = 100;
      }
    }
    return this.getProgress();
  }
}
