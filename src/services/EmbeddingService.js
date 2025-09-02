import crypto from 'crypto';
import OpenAI from 'openai';
import redis from './redisClient.js';

/**
 * EmbeddingService
 * - Caches embeddings in Redis by SHA256 hash of text
 * - Provides cosine similarity and top-K retrieval helpers
 */
class EmbeddingService {
  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.model = process.env.EMBEDDINGS_MODEL || 'text-embedding-3-small';
    this.cachePrefix = 'emb:';
    this.maxTextLength = parseInt(process.env.EMBEDDINGS_MAX_TEXT_LENGTH || '12000', 10);
  }

  _hash(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  async _getCachedEmbedding(hash) {
    try {
      const key = `${this.cachePrefix}${hash}`;
      const cached = await redis.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  }

  async _setCachedEmbedding(hash, vector) {
    try {
      const key = `${this.cachePrefix}${hash}`;
      // No expiry so re-use across restarts; callers can clear namespace if needed
      await redis.set(key, JSON.stringify(vector));
    } catch {
      // best-effort cache
    }
  }

  _truncate(text) {
    if (!text) return '';
    if (text.length <= this.maxTextLength) return text;
    return text.slice(0, this.maxTextLength);
  }

  async embedText(text) {
    const safe = this._truncate(text || '');
    const hash = this._hash(safe);

    const cached = await this._getCachedEmbedding(hash);
    if (cached) return cached;

    const response = await this.client.embeddings.create({
      model: this.model,
      input: safe
    });
    const vector = response.data?.[0]?.embedding || [];
    await this._setCachedEmbedding(hash, vector);
    return vector;
  }

  static cosineSimilarity(a, b) {
    if (!a?.length || !b?.length || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      const va = a[i];
      const vb = b[i];
      dot += va * vb;
      na += va * va;
      nb += vb * vb;
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  /**
   * Rank corpus items by similarity to query vector
   * @param {number[]} queryVec
   * @param {Array<{id: string, vector: number[], payload: any}>} corpus
   * @param {number} topK
   */
  static topK(queryVec, corpus, topK = 8) {
    const scored = [];
    for (const item of corpus) {
      if (!item?.vector?.length) continue;
      const score = EmbeddingService.cosineSimilarity(queryVec, item.vector);
      scored.push({ ...item, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}

const embeddingService = new EmbeddingService();
export default embeddingService;


