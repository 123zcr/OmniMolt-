import { Type } from "@sinclair/typebox";

export const ComputerToolSchema = Type.Object({
  action: Type.Unsafe<"screenshot" | "parse" | "click" | "type" | "key" | "scroll">(
    Type.String({
      description:
        "Action: screenshot (capture screen), parse (detect UI elements with OmniParser), click, type, key, scroll",
      enum: ["screenshot", "parse", "click", "type", "key", "scroll"],
    }),
  ),
  x: Type.Optional(Type.Number({ description: "X coordinate for click action" })),
  y: Type.Optional(Type.Number({ description: "Y coordinate for click action" })),
  text: Type.Optional(Type.String({ description: "Text to type" })),
  key: Type.Optional(
    Type.String({
      description:
        "Key to press (Enter, Tab, Escape, Backspace, Delete, Up, Down, Left, Right, F1-F12, Ctrl+C, etc.)",
    }),
  ),
  direction: Type.Optional(
    Type.Unsafe<"up" | "down">(
      Type.String({
        description: "Scroll direction",
        enum: ["up", "down"],
      }),
    ),
  ),
  clicks: Type.Optional(Type.Number({ description: "Number of clicks (1 or 2 for double-click)" })),
  button: Type.Optional(
    Type.Unsafe<"left" | "right">(
      Type.String({
        description: "Mouse button (left or right), default left",
        enum: ["left", "right"],
      }),
    ),
  ),
});
