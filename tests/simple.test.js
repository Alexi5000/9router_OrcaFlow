/**
 * Simple test to verify vitest is working
 */

import { describe, it, expect } from "vitest";

describe("Simple Test", () => {
  it("should work", () => {
    expect(1 + 1).toBe(2);
  });

  it("should fetch from server", async () => {
    const res = await fetch("http://localhost:20128/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fast",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 10,
      }),
    });

    expect(res.status).toBe(200);
    
    // Get text and extract JSON part (server may append streaming markers)
    const text = await res.text();
    const jsonStr = text.split("\n")[0]; // Take first line only
    const data = JSON.parse(jsonStr);
    
    expect(data.choices).toBeDefined();
    expect(data.model).toBeDefined();
  });
});
