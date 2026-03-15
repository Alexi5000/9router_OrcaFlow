import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import {
  OPENAI_RESPONSES_SCHEMA_ERROR_CODE,
  sanitizeOpenAIResponsesParameters,
} from "../../open-sse/translator/helpers/openaiResponsesSchema.js";

describe("OpenAI Responses schema sanitizer", () => {
  it("adds explicit properties to empty object schemas and cleans invalid required entries", () => {
    const result = sanitizeOpenAIResponsesParameters(
      {
        type: "object",
        properties: {},
        required: ["missing"],
      },
      true
    );

    expect(result.compatible).toBe(true);
    expect(result.strict).toBe(true);
    expect(result.parameters.type).toBe("object");
    expect(result.parameters.properties).toHaveProperty("_hint");
    expect(result.parameters.required).toBeUndefined();
  });

  it("flattens complex schema constructs, strips unsupported keywords, and downgrades strict mode when semantics changed", () => {
    const result = sanitizeOpenAIResponsesParameters(
      {
        type: ["object", "null"],
        title: "Tool Params",
        additionalProperties: false,
        required: ["choice", "missing"],
        properties: {
          choice: {
            anyOf: [
              { type: "null" },
              { type: "string", pattern: "^[a-z]+$" },
            ],
          },
          merged: {
            allOf: [
              {
                type: "object",
                properties: {
                  left: { const: 1 },
                },
                required: ["left"],
              },
              {
                properties: {
                  right: { type: "number", default: 0 },
                },
                required: ["right"],
              },
            ],
          },
          nested: {
            type: "object",
            required: ["child", "ghost"],
            properties: {
              child: {
                oneOf: [
                  { type: "null" },
                  { type: "integer", examples: [1] },
                ],
              },
            },
          },
        },
      },
      true
    );

    expect(result.compatible).toBe(true);
    expect(result.strict).toBe(false);
    expect(result.downgraded).toBe(true);
    expect(result.parameters.type).toBe("object");
    expect(result.parameters.title).toBeUndefined();
    expect(result.parameters.additionalProperties).toBeUndefined();
    expect(result.parameters.required).toEqual(["choice"]);
    expect(result.parameters.properties.choice.anyOf).toBeUndefined();
    expect(result.parameters.properties.choice.pattern).toBeUndefined();
    expect(result.parameters.properties.merged.allOf).toBeUndefined();
    expect(result.parameters.properties.merged.properties.left.enum).toEqual(["1"]);
    expect(result.parameters.properties.merged.properties.right.default).toBeUndefined();
    expect(result.parameters.properties.nested.properties.child.oneOf).toBeUndefined();
    expect(result.parameters.properties.nested.required).toEqual(["child"]);
  });

  it("keeps strict mode when the cleaned schema is already compatible", () => {
    const result = sanitizeOpenAIResponsesParameters(
      {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
      true
    );

    expect(result.compatible).toBe(true);
    expect(result.strict).toBe(true);
    expect(result.downgraded).toBe(false);
  });

  it("marks unsalvageable root schemas incompatible", () => {
    const result = sanitizeOpenAIResponsesParameters(
      {
        type: "string",
      },
      true
    );

    expect(result.compatible).toBe(false);
    expect(result.strict).toBe(false);
    expect(result.issues[0]).toContain("$.type must be \"object\"");
  });

  it("flags function tools without names as incompatible for the Responses path", () => {
    const translated = translateRequest(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI_RESPONSES,
      "gpt-5.4",
      {
        model: "gpt-5.4",
        input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
        tools: [
          {
            type: "function",
            description: "Nameless tool",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        ],
      },
      true
    );

    expect(translated._schemaIncompatibility).toMatchObject({
      code: OPENAI_RESPONSES_SCHEMA_ERROR_CODE,
    });
    expect(translated._schemaIncompatibility.message).toContain("function tools must have a non-empty name");
  });
});

describe("OpenAI Responses translator integration", () => {
  it("sanitizes converted chat-completions tools before they leave the translator", () => {
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "gpt-5.4",
      {
        messages: [{ role: "user", content: "hi" }],
        tools: [
          {
            type: "function",
            function: {
              name: "mcp__pencil__get_style_guide_tags",
              description: "Get style guide tags.",
              parameters: {
                type: "object",
                properties: {},
              },
              strict: true,
            },
          },
        ],
      },
      true
    );

    expect(translated.tools).toHaveLength(1);
    expect(translated.tools[0].name).toBe("mcp__pencil__get_style_guide_tags");
    expect(translated.tools[0].parameters.properties).toHaveProperty("_hint");
    expect(translated.tools[0].strict).toBe(true);
    expect(translated._schemaIncompatibility).toBeUndefined();
  });

  it("flags same-format responses requests with unsalvageable tool schemas for request-scoped fallback", () => {
    const translated = translateRequest(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI_RESPONSES,
      "gpt-5.4",
      {
        model: "gpt-5.4",
        input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
        tools: [
          {
            type: "function",
            name: "mcp__pencil__get_style_guide_tags",
            description: "Get style guide tags.",
            parameters: {
              type: "string",
            },
            strict: true,
          },
        ],
      },
      true
    );

    expect(translated._schemaIncompatibility).toMatchObject({
      code: OPENAI_RESPONSES_SCHEMA_ERROR_CODE,
    });
    expect(translated._schemaIncompatibility.message).toContain("mcp__pencil__get_style_guide_tags");
  });

  it("flags Claude-native built-in tools as incompatible for OpenAI Responses providers", () => {
    const translated = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.OPENAI_RESPONSES,
      "gpt-5.4",
      {
        model: "claude-sonnet-4-6",
        max_tokens: 32,
        messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly OK." }] }],
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 1,
          },
        ],
      },
      true
    );

    expect(translated._schemaIncompatibility).toMatchObject({
      code: OPENAI_RESPONSES_SCHEMA_ERROR_CODE,
    });
    expect(translated._schemaIncompatibility.message).toContain("web_search_20250305");
  });
});
