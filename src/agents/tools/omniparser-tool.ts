/**
 * OmniParser tool for UI element detection via local OmniParser API
 * Enables screen parsing and element identification for automation
 */

import fs from "node:fs/promises";

import { createOmniParserClient, type OmniParserParseResponse } from "../../omniparser/index.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";
import { OmniParserToolSchema } from "./omniparser-tool.schema.js";

// Cache the last parse response for find operations
let lastParseResponse: OmniParserParseResponse | null = null;

export function createOmniParserTool(opts?: { baseUrl?: string }): AnyAgentTool {
  return {
    label: "OmniParser",
    name: "omniparser",
    description: [
      "Parse screenshots to detect UI elements using OmniParser.",
      "Actions: health (check API), parse (analyze image), find (search elements).",
      "Use parse to analyze a screenshot and get all UI elements with their positions.",
      "Use find after parse to search for specific elements by text.",
      "Supports 2560x1440 and other high-resolution screenshots.",
      "Returns element IDs, content descriptions, and bounding boxes.",
    ].join(" "),
    parameters: OmniParserToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const baseUrl = readStringParam(params, "base_url") ?? opts?.baseUrl;

      const client = createOmniParserClient({ baseUrl });

      switch (action) {
        case "health": {
          const health = await client.health();
          return jsonResult(health);
        }

        case "parse": {
          const imageBase64 = readStringParam(params, "image_base64");
          const imagePath = readStringParam(params, "image_path");

          if (!imageBase64 && !imagePath) {
            throw new Error("Either image_base64 or image_path is required for parse action");
          }

          let base64: string;
          if (imageBase64) {
            base64 = imageBase64;
          } else {
            const buffer = await fs.readFile(imagePath!);
            base64 = buffer.toString("base64");
          }

          const result = await client.parse(base64);
          if (!result.success) {
            throw new Error(result.error ?? "Parse failed");
          }

          // Cache for subsequent find operations
          lastParseResponse = result;

          // Return summary with element count and details
          return jsonResult({
            success: true,
            image_size: result.image_size,
            element_count: result.element_count,
            elements: result.elements.map((el) => ({
              id: el.id,
              content: el.content,
            })),
            hint: "Use action=find with search_text to search for specific elements",
          });
        }

        case "find": {
          const searchText = readStringParam(params, "search_text");
          const x = readNumberParam(params, "x");
          const y = readNumberParam(params, "y");

          if (!lastParseResponse) {
            throw new Error("No parse results available. Run action=parse first.");
          }

          if (searchText) {
            const matches = client.findElementsByText(lastParseResponse, searchText);
            return jsonResult({
              search_text: searchText,
              match_count: matches.length,
              matches: matches.map((el) => ({
                id: el.id,
                content: el.content,
                bbox: el.bbox,
                center: el.center,
              })),
            });
          }

          if (typeof x === "number" && typeof y === "number") {
            const element = client.getElementAtPoint(lastParseResponse, x, y);
            return jsonResult({
              point: { x, y },
              element: element
                ? {
                    id: element.id,
                    content: element.content,
                    bbox: element.bbox,
                    center: element.center,
                  }
                : null,
            });
          }

          throw new Error("search_text or (x, y) coordinates required for find action");
        }

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
}
