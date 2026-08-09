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
  image?: { dataBase64: string; mimeType: string; name: string };
}

export interface StyleImageResult {
  success: boolean;
  imageDataUrl?: string;
  revisedPrompt?: string;
  error?: string;
}
