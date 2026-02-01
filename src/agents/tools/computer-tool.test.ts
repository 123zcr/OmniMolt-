import { describe, expect, it } from "vitest";

import { createComputerTool } from "./computer-tool.js";

describe("createComputerTool", () => {
  it("creates tool with correct name and label", () => {
    const tool = createComputerTool();
    expect(tool.name).toBe("desktop");
    expect(tool.label).toBe("Desktop Control");
  });

  it("creates tool with custom omniparser URL", () => {
    const tool = createComputerTool({ omniparserUrl: "http://localhost:9999" });
    expect(tool.name).toBe("computer");
  });

  it("has all required actions in description", () => {
    const tool = createComputerTool();
    expect(tool.description).toContain("screenshot");
    expect(tool.description).toContain("parse");
    expect(tool.description).toContain("click");
    expect(tool.description).toContain("type");
    expect(tool.description).toContain("key");
    expect(tool.description).toContain("scroll");
  });

  it("has execute function", () => {
    const tool = createComputerTool();
    expect(typeof tool.execute).toBe("function");
  });
});
