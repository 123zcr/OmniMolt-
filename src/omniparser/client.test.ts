import { describe, expect, it, vi } from "vitest";

import { createOmniParserClient, OmniParserClient } from "./client.js";

describe("OmniParserClient", () => {
  it("creates client with default config", () => {
    const client = createOmniParserClient();
    expect(client).toBeInstanceOf(OmniParserClient);
  });

  it("creates client with custom config", () => {
    const client = createOmniParserClient({
      baseUrl: "http://localhost:9999",
      timeoutMs: 30000,
    });
    expect(client).toBeInstanceOf(OmniParserClient);
  });

  it("findElementsByText filters correctly", () => {
    const client = createOmniParserClient();
    const response = {
      success: true,
      image_size: { width: 2560, height: 1440 },
      element_count: 3,
      elements: [
        { id: 0, content: "Button: Submit" },
        { id: 1, content: "Text: Hello World" },
        { id: 2, content: "Button: Cancel" },
      ],
    };

    const buttons = client.findElementsByText(response, "Button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].content).toBe("Button: Submit");
    expect(buttons[1].content).toBe("Button: Cancel");
  });

  it("findElementsByText is case-insensitive", () => {
    const client = createOmniParserClient();
    const response = {
      success: true,
      image_size: { width: 1920, height: 1080 },
      element_count: 1,
      elements: [{ id: 0, content: "HELLO WORLD" }],
    };

    const results = client.findElementsByText(response, "hello");
    expect(results).toHaveLength(1);
  });

  it("getElementAtPoint returns element at coordinates", () => {
    const client = createOmniParserClient();
    const response = {
      success: true,
      image_size: { width: 1000, height: 1000 },
      element_count: 1,
      elements: [
        {
          id: 0,
          content: "Test Element",
          bbox: [0.1, 0.1, 0.3, 0.3] as [number, number, number, number],
        },
      ],
    };

    // Point inside the element (200, 200 in 1000x1000 = 0.2, 0.2 normalized)
    const found = client.getElementAtPoint(response, 200, 200);
    expect(found).toBeDefined();
    expect(found?.content).toBe("Test Element");

    // Point outside the element
    const notFound = client.getElementAtPoint(response, 500, 500);
    expect(notFound).toBeUndefined();
  });

  it("getElementAtPoint handles empty image size", () => {
    const client = createOmniParserClient();
    const response = {
      success: false,
      image_size: { width: 0, height: 0 },
      element_count: 0,
      elements: [],
    };

    const result = client.getElementAtPoint(response, 100, 100);
    expect(result).toBeUndefined();
  });

  it("health returns error on connection failure", async () => {
    const client = createOmniParserClient({ baseUrl: "http://127.0.0.1:1" });
    const result = await client.health();
    expect(result.status).toBe("error");
  });

  it("parse returns error on connection failure", async () => {
    const client = createOmniParserClient({ baseUrl: "http://127.0.0.1:1" });
    const result = await client.parse("dGVzdA==");
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
