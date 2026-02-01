/**
 * Computer Use tool for desktop automation
 * Supports screenshot, OmniParser UI detection, click, type, key, scroll
 * Works on Windows with DPI-aware coordinate handling
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createOmniParserClient } from "../../omniparser/index.js";
import type { AnyAgentTool } from "./common.js";
import { imageResult, jsonResult, readNumberParam, readStringParam } from "./common.js";
import { ComputerToolSchema } from "./computer-tool.schema.js";

const OMNIPARSER_API_URL = "http://127.0.0.1:8765";

// DPI-aware screenshot command (returns physical resolution)
function getScreenshotCommand(outputPath: string): string {
  const escapedPath = outputPath.replace(/\\/g, "/");
  return `powershell -ExecutionPolicy Bypass -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class DPI { [DllImport(\\\"user32.dll\\\")] public static extern bool SetProcessDPIAware(); }'; [DPI]::SetProcessDPIAware() | Out-Null; Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${escapedPath}'); Write-Output $bmp.Width,$bmp.Height; $g.Dispose(); $bmp.Dispose()"`;
}

// DPI-aware click script
function getClickScript(x: number, y: number, button: string, clicks: number): string {
  const clickDown = button === "right" ? "MOUSEEVENTF_RIGHTDOWN" : "MOUSEEVENTF_LEFTDOWN";
  const clickUp = button === "right" ? "MOUSEEVENTF_RIGHTUP" : "MOUSEEVENTF_LEFTUP";
  const doubleClick =
    clicks === 2
      ? `
Start-Sleep -Milliseconds 100
[ClickHelper]::mouse_event([ClickHelper]::${clickDown}, 0, 0, 0, 0)
[ClickHelper]::mouse_event([ClickHelper]::${clickUp}, 0, 0, 0, 0)`
      : "";

  return `Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class ClickHelper {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", CharSet = CharSet.Auto, CallingConvention = CallingConvention.StdCall)]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);
  public const uint MOUSEEVENTF_LEFTDOWN = 0x02;
  public const uint MOUSEEVENTF_LEFTUP = 0x04;
  public const uint MOUSEEVENTF_RIGHTDOWN = 0x08;
  public const uint MOUSEEVENTF_RIGHTUP = 0x10;
}
'@
[ClickHelper]::SetProcessDPIAware() | Out-Null
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
Start-Sleep -Milliseconds 50
[ClickHelper]::mouse_event([ClickHelper]::${clickDown}, 0, 0, 0, 0)
[ClickHelper]::mouse_event([ClickHelper]::${clickUp}, 0, 0, 0, 0)${doubleClick}
`;
}

export function createComputerTool(opts?: {
  omniparserUrl?: string;
}): AnyAgentTool {
  const omniparserUrl = opts?.omniparserUrl ?? OMNIPARSER_API_URL;

  return {
    label: "Desktop Control",
    name: "desktop",
    description: [
      "Control the computer desktop: screenshot, parse UI elements, click, type, press keys, scroll.",
      "Use 'screenshot' to capture the screen and return as image.",
      "Use 'parse' to capture screen AND detect all UI elements with OmniParser (returns coordinates).",
      "Use 'click' with x,y coordinates to click (use coordinates from parse results).",
      "Use 'type' to input text at current cursor position.",
      "Use 'key' to press keyboard keys (Enter, Tab, Escape, Ctrl+C, etc.).",
      "Use 'scroll' to scroll up or down.",
      "Workflow: parse -> find element -> click -> type/key if needed.",
    ].join(" "),
    parameters: ComputerToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      // Check if running on Windows
      if (process.platform !== "win32") {
        return jsonResult({
          error: "Computer tool is only available on Windows",
          platform: process.platform,
        });
      }

      try {
        if (action === "screenshot") {
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          const screenshotPath = path.join(os.tmpdir(), `computer-screenshot-${timestamp}.png`);

          const cmd = getScreenshotCommand(screenshotPath);
          const output = execSync(cmd, { encoding: "utf-8", windowsHide: true, timeout: 15000 });
          const [width, height] = output.trim().split(/\r?\n/).map(Number);

          if (!fs.existsSync(screenshotPath)) {
            throw new Error("Screenshot capture failed");
          }

          const imageBuffer = fs.readFileSync(screenshotPath);
          const base64Data = imageBuffer.toString("base64");

          return await imageResult({
            label: "computer:screenshot",
            path: screenshotPath,
            base64: base64Data,
            mimeType: "image/png",
            extraText: `Screenshot captured. Screen size: ${width}x${height}. Use action="parse" to detect UI elements with coordinates.`,
            details: { width, height },
          });
        }

        if (action === "parse") {
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          const screenshotPath = path.join(os.tmpdir(), `computer-parse-${timestamp}.png`);

          const cmd = getScreenshotCommand(screenshotPath);
          const output = execSync(cmd, { encoding: "utf-8", windowsHide: true, timeout: 15000 });
          const [width, height] = output.trim().split(/\r?\n/).map(Number);

          if (!fs.existsSync(screenshotPath)) {
            throw new Error("Screenshot capture failed");
          }

          const imageBuffer = fs.readFileSync(screenshotPath);
          const base64Data = imageBuffer.toString("base64");

          // Call OmniParser API
          try {
            const client = createOmniParserClient({ baseUrl: omniparserUrl });
            const result = await client.parse(base64Data);

            if (!result.success) {
              throw new Error(result.error ?? "OmniParser failed");
            }

            // Convert elements: normalized coordinates -> pixel coordinates
            const screenWidth = width;
            const screenHeight = height;

            interface ParsedElement {
              id: number;
              label: string;
              interactivity: boolean;
              center: { x: number; y: number };
              bbox: { x1: number; y1: number; x2: number; y2: number };
            }

            const parsedElements: ParsedElement[] = (result.elements || []).map((e) => {
              const content = e.content as {
                type?: string;
                bbox?: [number, number, number, number];
                interactivity?: boolean;
                content?: string;
              };
              const bbox = content?.bbox ?? [0, 0, 0, 0];
              const [x1, y1, x2, y2] = bbox;
              const centerX = Math.round(((x1 + x2) / 2) * screenWidth);
              const centerY = Math.round(((y1 + y2) / 2) * screenHeight);
              return {
                id: e.id,
                label: String(content?.content ?? ""),
                interactivity: content?.interactivity ?? false,
                center: { x: centerX, y: centerY },
                bbox: {
                  x1: Math.round(x1 * screenWidth),
                  y1: Math.round(y1 * screenHeight),
                  x2: Math.round(x2 * screenWidth),
                  y2: Math.round(y2 * screenHeight),
                },
              };
            });

            // Format element list
            const elementList = parsedElements
              .map(
                (e) =>
                  `[${e.id}] "${e.label}" at (${e.center.x}, ${e.center.y})${e.interactivity ? " [interactive]" : ""}`,
              )
              .join("\n");

            return await imageResult({
              label: "computer:parse",
              path: screenshotPath,
              base64: base64Data,
              mimeType: "image/png",
              extraText: `OmniParser detected ${result.element_count || 0} UI elements.\nScreen: ${screenWidth}x${screenHeight}\n\n${elementList}\n\nTo click an element, use: action="click", x=<center_x>, y=<center_y>`,
              details: {
                width: screenWidth,
                height: screenHeight,
                element_count: parsedElements.length,
                elements: parsedElements,
              },
            });
          } catch (err) {
            // OmniParser not available, return screenshot only
            return await imageResult({
              label: "computer:parse",
              path: screenshotPath,
              base64: base64Data,
              mimeType: "image/png",
              extraText: `OmniParser not available (${String(err)}). Screenshot captured. Screen size: ${width}x${height}. Analyze the image manually to find coordinates.`,
              details: { width, height, omniparser_error: String(err) },
            });
          }
        }

        if (action === "click") {
          const x = readNumberParam(params, "x", { required: true, integer: true });
          const y = readNumberParam(params, "y", { required: true, integer: true });
          const clicks = readNumberParam(params, "clicks", { integer: true }) ?? 1;
          const button = readStringParam(params, "button") ?? "left";

          const psScript = getClickScript(x!, y!, button, clicks);
          const scriptPath = path.join(os.tmpdir(), `click-${Date.now()}.ps1`);
          fs.writeFileSync(scriptPath, psScript, "ascii");

          try {
            execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, {
              encoding: "utf-8",
              windowsHide: true,
              timeout: 10000,
            });
          } finally {
            try {
              fs.unlinkSync(scriptPath);
            } catch {
              /* ignore */
            }
          }

          return jsonResult({
            success: true,
            action: "click",
            x,
            y,
            clicks,
            button,
            message: `Clicked at (${x}, ${y}) with ${button} button${clicks === 2 ? " (double-click)" : ""}`,
          });
        }

        if (action === "type") {
          const text = readStringParam(params, "text", { required: true });

          // Escape special characters for SendKeys
          const escapedText = text!
            .replace(/\+/g, "{+}")
            .replace(/\^/g, "{^}")
            .replace(/%/g, "{%}")
            .replace(/~/g, "{~}")
            .replace(/\(/g, "{(}")
            .replace(/\)/g, "{)}")
            .replace(/\[/g, "{[}")
            .replace(/\]/g, "{]}")
            .replace(/\{/g, "{{}")
            .replace(/\}/g, "{}}");

          const typeCmd = `powershell -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escapedText.replace(/'/g, "''")}')"`;

          execSync(typeCmd, { encoding: "utf-8", windowsHide: true, timeout: 10000 });

          return jsonResult({
            success: true,
            action: "type",
            text,
            message: `Typed: "${text}"`,
          });
        }

        if (action === "key") {
          const key = readStringParam(params, "key", { required: true });

          // Virtual key codes for keybd_event
          const vkCodes: Record<string, number> = {
            // Modifier keys
            win: 0x5b, // VK_LWIN
            lwin: 0x5b,
            rwin: 0x5c,
            ctrl: 0x11, // VK_CONTROL
            control: 0x11,
            alt: 0x12, // VK_MENU
            shift: 0x10, // VK_SHIFT
            // Common keys
            enter: 0x0d,
            return: 0x0d,
            tab: 0x09,
            escape: 0x1b,
            esc: 0x1b,
            backspace: 0x08,
            delete: 0x2e,
            del: 0x2e,
            space: 0x20,
            // Arrow keys
            up: 0x26,
            down: 0x28,
            left: 0x25,
            right: 0x27,
            // Navigation
            home: 0x24,
            end: 0x23,
            pageup: 0x21,
            pgup: 0x21,
            pagedown: 0x22,
            pgdn: 0x22,
            insert: 0x2d,
            // Function keys
            f1: 0x70,
            f2: 0x71,
            f3: 0x72,
            f4: 0x73,
            f5: 0x74,
            f6: 0x75,
            f7: 0x76,
            f8: 0x77,
            f9: 0x78,
            f10: 0x79,
            f11: 0x7a,
            f12: 0x7b,
            // Letters (A-Z: 0x41-0x5A)
            a: 0x41, b: 0x42, c: 0x43, d: 0x44, e: 0x45,
            f: 0x46, g: 0x47, h: 0x48, i: 0x49, j: 0x4a,
            k: 0x4b, l: 0x4c, m: 0x4d, n: 0x4e, o: 0x4f,
            p: 0x50, q: 0x51, r: 0x52, s: 0x53, t: 0x54,
            u: 0x55, v: 0x56, w: 0x57, x: 0x58, y: 0x59, z: 0x5a,
            // Numbers (0-9: 0x30-0x39)
            "0": 0x30, "1": 0x31, "2": 0x32, "3": 0x33, "4": 0x34,
            "5": 0x35, "6": 0x36, "7": 0x37, "8": 0x38, "9": 0x39,
            // Special
            printscreen: 0x2c,
            prtsc: 0x2c,
            pause: 0x13,
            capslock: 0x14,
            numlock: 0x90,
            scrolllock: 0x91,
          };

          const lowerKey = key!.toLowerCase();
          const parts = lowerKey.split("+").map((p) => p.trim());

          // Collect all key codes to press
          const keyCodes: number[] = [];
          for (const part of parts) {
            const code = vkCodes[part];
            if (code !== undefined) {
              keyCodes.push(code);
            } else if (part.length === 1) {
              // Single character - try to get its virtual key code
              const charCode = part.toUpperCase().charCodeAt(0);
              if (charCode >= 0x30 && charCode <= 0x5a) {
                keyCodes.push(charCode);
              }
            }
          }

          if (keyCodes.length === 0) {
            throw new Error(`Unknown key: ${key}`);
          }

          // Build PowerShell script using keybd_event
          const keyDownCalls = keyCodes.map((code) => `[KeyHelper]::keybd_event(${code}, 0, 0, 0)`).join("; ");
          const keyUpCalls = keyCodes
            .reverse()
            .map((code) => `[KeyHelper]::keybd_event(${code}, 0, 2, 0)`)
            .join("; ");

          const keyScript = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class KeyHelper {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);
}
'@
${keyDownCalls}
Start-Sleep -Milliseconds 50
${keyUpCalls}
`;

          const scriptPath = path.join(os.tmpdir(), `key-${Date.now()}.ps1`);
          fs.writeFileSync(scriptPath, keyScript, "ascii");

          try {
            execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, {
              encoding: "utf-8",
              windowsHide: true,
              timeout: 10000,
            });
          } finally {
            try {
              fs.unlinkSync(scriptPath);
            } catch {
              /* ignore */
            }
          }

          return jsonResult({
            success: true,
            action: "key",
            key,
            keyCodes,
            message: `Pressed key: ${key}`,
          });
        }

        if (action === "scroll") {
          const direction = readStringParam(params, "direction", { required: true });
          const scrollAmount = direction === "up" ? 3 : -3;

          const scrollCmd = `powershell -ExecutionPolicy Bypass -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class ScrollHelper { [DllImport(\\\"user32.dll\\\")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, uint dwExtraInfo); public const uint MOUSEEVENTF_WHEEL = 0x0800; }'; [ScrollHelper]::mouse_event([ScrollHelper]::MOUSEEVENTF_WHEEL, 0, 0, ${scrollAmount * 120}, 0)"`;

          execSync(scrollCmd, { encoding: "utf-8", windowsHide: true, timeout: 5000 });

          return jsonResult({
            success: true,
            action: "scroll",
            direction,
            message: `Scrolled ${direction}`,
          });
        }

        return jsonResult({ error: `Unknown action: ${action}` });
      } catch (err) {
        return jsonResult({
          success: false,
          error: `Computer action failed: ${String(err)}`,
        });
      }
    },
  };
}
