declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    LLM_ENDPOINT?: string;
    LLM_API_KEY?: string;
    ANTHROPIC_API_KEY?: string;
    PLOSTAIN_PROVIDER?: string;
  }
}
