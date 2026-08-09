export interface StyleImageRequest {
  provider?: 'openai-compatible' | 'minimax';
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  size: string;
  quality: string;
  aspectRatio?: string;
  promptOptimizer?: boolean;
  seed?: number;
  aigcWatermark?: boolean;
  image?: { dataBase64?: string; mimeType?: string; name?: string; url?: string };
}

export interface StyleImageResult {
  success: boolean;
  imageDataUrl?: string;
  revisedPrompt?: string;
  error?: string;
}
