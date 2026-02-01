import { Type } from "@sinclair/typebox";

export const OmniParserToolSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal("health"),
      Type.Literal("parse"),
      Type.Literal("find"),
    ],
    {
      description:
        "Action to perform: health (check API status), parse (analyze screenshot), find (search elements by text)",
    },
  ),
  image_base64: Type.Optional(
    Type.String({
      description: "Base64 encoded image for parse action (PNG or JPEG)",
    }),
  ),
  image_path: Type.Optional(
    Type.String({
      description: "Path to image file for parse action (alternative to image_base64)",
    }),
  ),
  search_text: Type.Optional(
    Type.String({
      description: "Text to search for in elements (for find action after parse)",
    }),
  ),
  x: Type.Optional(
    Type.Number({
      description: "X coordinate in pixels to find element at point",
    }),
  ),
  y: Type.Optional(
    Type.Number({
      description: "Y coordinate in pixels to find element at point",
    }),
  ),
  base_url: Type.Optional(
    Type.String({
      description: "OmniParser API base URL (default: http://127.0.0.1:8765)",
    }),
  ),
});
