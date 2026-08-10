import type { AudioAnalysis } from './types';

export interface HighAccuracyAnalyzerStatus {
  available: boolean;
  engine: 'all-in-one';
  reason?: string;
}

export async function getHighAccuracyAnalyzerStatus(): Promise<HighAccuracyAnalyzerStatus> {
  return { available: false, engine: 'all-in-one', reason: '高精度 All-In-One Python worker 尚未安装' };
}

export async function analyzeWithHighAccuracy(file: File): Promise<AudioAnalysis> {
  void file;
  throw new Error('高精度分析尚未实现。当前版本请使用 Meyda 本地轻量分析。');
}
