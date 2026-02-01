/**
 * OmniParser API client for UI element detection
 * Connects to local OmniParser server for screen parsing
 */

import type {
  OmniParserConfig,
  OmniParserHealthResponse,
  OmniParserParseRequest,
  OmniParserParseResponse,
} from "./types.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:8765";
const DEFAULT_TIMEOUT_MS = 60_000;

export class OmniParserClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(config?: OmniParserConfig) {
    this.baseUrl = (config?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Check if OmniParser server is healthy
   */
  async health(): Promise<OmniParserHealthResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        signal: controller.signal,
      });

      if (!res.ok) {
        return { status: "error" };
      }

      return (await res.json()) as OmniParserHealthResponse;
    } catch {
      return { status: "error" };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Parse an image and detect UI elements
   * @param imageBase64 Base64 encoded image (PNG or JPEG)
   * @returns Parsed elements with bounding boxes
   */
  async parse(imageBase64: string): Promise<OmniParserParseResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const body: OmniParserParseRequest = { image_base64: imageBase64 };

      const res = await fetch(`${this.baseUrl}/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          success: false,
          image_size: { width: 0, height: 0 },
          element_count: 0,
          elements: [],
          error: `HTTP ${res.status}: ${text}`,
        };
      }

      return (await res.json()) as OmniParserParseResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        image_size: { width: 0, height: 0 },
        element_count: 0,
        elements: [],
        error: message.includes("abort") ? "Request timed out" : message,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Parse a screenshot buffer directly
   * @param buffer Image buffer (PNG or JPEG)
   * @returns Parsed elements with bounding boxes
   */
  async parseBuffer(buffer: Buffer): Promise<OmniParserParseResponse> {
    const base64 = buffer.toString("base64");
    return this.parse(base64);
  }

  /**
   * Find elements containing specific text
   * @param response Parse response
   * @param searchText Text to search for (case-insensitive)
   * @returns Matching elements
   */
  findElementsByText(
    response: OmniParserParseResponse,
    searchText: string,
  ): OmniParserParseResponse["elements"] {
    const lower = searchText.toLowerCase();
    return response.elements.filter((el) => el.content.toLowerCase().includes(lower));
  }

  /**
   * Get element at specific coordinates
   * @param response Parse response
   * @param x X coordinate in pixels
   * @param y Y coordinate in pixels
   * @returns Element at coordinates, or undefined
   */
  getElementAtPoint(
    response: OmniParserParseResponse,
    x: number,
    y: number,
  ): OmniParserParseResponse["elements"][0] | undefined {
    const { width, height } = response.image_size;
    if (width === 0 || height === 0) return undefined;

    // Normalize to 0-1 range
    const nx = x / width;
    const ny = y / height;

    return response.elements.find((el) => {
      if (!el.bbox) return false;
      const [x1, y1, x2, y2] = el.bbox;
      return nx >= x1 && nx <= x2 && ny >= y1 && ny <= y2;
    });
  }
}

/**
 * Create a default OmniParser client instance
 */
export function createOmniParserClient(config?: OmniParserConfig): OmniParserClient {
  return new OmniParserClient(config);
}
