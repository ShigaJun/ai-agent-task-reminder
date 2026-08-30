import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';

/**
 * LLM APIクライアント
 * Google Gemini APIを使用してLLMと通信する
 */
export class LlmClient {
  private client: GoogleGenerativeAI;
  private model: string;

  constructor() {
    this.client = new GoogleGenerativeAI(config.llm.apiKey);
    this.model = config.llm.model;
  }

  /**
   * LLMにプロンプトを送信しレスポンスを取得
   * @param prompt プロンプト
   * @param systemPrompt システムプロンプト
   * @returns LLMのレスポンス
   */
  async generateResponse(prompt: string, systemPrompt?: string): Promise<string> {
    try {
      const model = this.client.getGenerativeModel({
        model: this.model,
        systemInstruction: systemPrompt,
      });

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2000,
        },
      });

      const response = result.response;
      return response.text() || '';
    } catch (error) {
      console.error('LLM API error:', error);
      throw new Error(`Failed to get LLM response: ${error}`);
    }
  }

  /**
   * LLMにプロンプトを送信しJSON形式のレスポンスを取得
   * @param prompt プロンプト
   * @param systemPrompt システムプロンプト
   * @returns パースされたJSONオブジェクト
   */
  async generateJsonResponse<T>(prompt: string, systemPrompt?: string): Promise<T> {
    const response = await this.generateResponse(prompt, systemPrompt);

    try {
      // JSONコードブロックを除去
      const jsonStr = response.replace(/```json\n?|\n?```/g, '').trim();
      return JSON.parse(jsonStr) as T;
    } catch (error) {
      console.error('Failed to parse LLM JSON response:', error);
      console.error('Raw response:', response);
      throw new Error(`Failed to parse LLM JSON response: ${error}`);
    }
  }
}