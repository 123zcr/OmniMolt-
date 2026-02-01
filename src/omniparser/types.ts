/**
 * OmniParser API types for UI element detection
 */

export type OmniParserElement = {
  id: number;
  content: string;
  /** Normalized bounding box [x1, y1, x2, y2] in 0-1 range */
  bbox?: [number, number, number, number];
  /** Pixel bounding box [x1, y1, x2, y2] */
  bboxPixels?: [number, number, number, number];
  /** Center point in pixels [x, y] */
  center?: [number, number];
};

export type OmniParserParseRequest = {
  /** Base64 encoded image */
  image_base64: string;
};

export type OmniParserParseResponse = {
  success: boolean;
  image_size: {
    width: number;
    height: number;
  };
  element_count: number;
  elements: OmniParserElement[];
  /** Base64 encoded labeled image with bounding boxes */
  labeled_image?: string;
  error?: string;
};

export type OmniParserHealthResponse = {
  status: "ok" | "error";
  device?: string;
  model_loaded?: boolean;
};

export type OmniParserConfig = {
  /** API base URL, defaults to http://127.0.0.1:8765 */
  baseUrl?: string;
  /** Request timeout in milliseconds, defaults to 60000 */
  timeoutMs?: number;
};
