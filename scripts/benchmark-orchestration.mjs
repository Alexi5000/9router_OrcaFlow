const BASE_URL = process.env.ORCAFLOW_BASE_URL || "http://localhost:20128/v1/chat/completions";

const DEFAULT_BASELINE = "claude/claude-opus-4-6";
const DEFAULT_CANDIDATES = [
  "github/gpt-4.1",
  "github/gpt-5-mini",
  "github/gpt-4o-mini",
  "groq/openai/gpt-oss-120b",
  "groq/llama-3.3-70b-versatile",
  "groq/qwen/qwen3-32b",
  "kilocode/arcee-ai/trinity-large-preview:free",
  "kilocode/openrouter/healer-alpha",
  "kilocode/openrouter/hunter-alpha",
  "kilocode/nvidia/nemotron-3-super-120b-a12b:free",
];

function getArgs() {
  const args = process.argv.slice(2);
  const models = [];
  let baseline = DEFAULT_BASELINE;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--baseline" && args[i + 1]) {
      baseline = args[i + 1];
      i++;
      continue;
    }
    models.push(args[i]);
  }

  return {
    baseline,
    candidates: models.length > 0 ? models : DEFAULT_CANDIDATES,
  };
}

function normalizeText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : (part?.text || part?.content || "")))
      .join("");
  }
  if (content && typeof content === "object") {
    return content.text || content.content || JSON.stringify(content);
  }
  return "";
}

async function chat(body) {
  const start = Date.now();
  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }
  return {
    status: response.status,
    latency: Date.now() - start,
    json,
    raw,
  };
}

function extractAssistant(resp) {
  const message = resp.json?.choices?.[0]?.message;
  return {
    content: normalizeText(message?.content),
    toolCalls: message?.tool_calls || [],
    finishReason: resp.json?.choices?.[0]?.finish_reason || null,
    rawMessage: message || null,
  };
}

function scoreExact(text) {
  const trimmed = text.trim();
  if (trimmed === "OK") return 2;
  if (/\bOK\b/i.test(trimmed)) return 1;
  return 0;
}

function scoreJson(text) {
  try {
    const parsed = JSON.parse(text.trim());
    let score = 0;
    if (parsed.sum === 42) score++;
    if (parsed.parity === "even") score++;
    return score;
  } catch {
    return 0;
  }
}

function scoreCode(text) {
  const cleaned = text
    .replace(/^```(?:javascript|js)?\s*/i, "")
    .replace(/```$/, "")
    .trim();

  if (!/^function\s+fib/.test(cleaned) && !/^const\s+fib\s*=/.test(cleaned) && !/^let\s+fib\s*=/.test(cleaned)) {
    return 0;
  }

  let score = 0;
  if ((/for\s*\(/.test(cleaned) || /while\s*\(/.test(cleaned)) && !/fib\s*\(\s*n\s*-\s*1/.test(cleaned)) {
    score += 1;
  }

  try {
    const runner = new Function(`${cleaned}; return typeof fib === "function" ? fib : null;`);
    const fib = runner();
    if (typeof fib !== "function") return score;

    const cases = [
      [0, 0],
      [1, 1],
      [2, 1],
      [7, 13],
      [10, 55],
    ];
    let correct = 0;
    for (const [input, expected] of cases) {
      if (fib(input) === expected) correct++;
    }
    if (correct >= 3) score += 1;
    if (correct === cases.length) score += 2;
  } catch {
    // Leave score as-is when code cannot execute cleanly.
  }

  return score;
}

const TOOL_STATE = {
  files: {
    "src/math.js": "export function isEven(n) { return n % 2 === 1; }\nexport function isOdd(n) { return n % 2 !== 0; }",
    "tests/math.test.js": "import { isEven } from \"../src/math.js\";\ntest(\"isEven\", () => {\n  expect(isEven(2)).toBe(true);\n  expect(isEven(3)).toBe(false);\n  expect(isEven(0)).toBe(true);\n  expect(isEven(-4)).toBe(true);\n});",
  },
};

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_repo",
      description: "Search the synthetic repo for relevant code or test references.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file from the synthetic repo.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delegate_subtask",
      description: "Delegate a focused subtask to planner, coder, or reviewer.",
      parameters: {
        type: "object",
        properties: {
          agent: { type: "string", enum: ["planner", "coder", "reviewer"] },
          task: { type: "string" },
        },
        required: ["agent", "task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_validation",
      description: "Validate a proposed patch against the synthetic tests.",
      parameters: {
        type: "object",
        properties: { patch: { type: "string" } },
        required: ["patch"],
      },
    },
  },
];

function toolResponse(name, args) {
  if (name === "search_repo") {
    return {
      hits: [
        "src/math.js: export function isEven(n) { return n % 2 === 1; }",
        "tests/math.test.js: expect(isEven(3)).toBe(false); expect(isEven(2)).toBe(true);",
      ],
      note: "The failure appears related to parity logic in isEven.",
    };
  }

  if (name === "read_file") {
    return {
      path: args.path,
      content: TOOL_STATE.files[args.path] || "FILE_NOT_FOUND",
    };
  }

  if (name === "delegate_subtask") {
    const responses = {
      planner: "Inspect src/math.js and tests first. Root cause likely inverted parity comparison.",
      coder: "The correct one-line patch is `return n % 2 === 0;` for even checks.",
      reviewer: "Validation should cover 2=>true, 3=>false, 0=>true, -4=>true, -3=>false.",
    };
    return {
      agent: args.agent,
      result: responses[args.agent] || "No suggestion",
    };
  }

  if (name === "run_validation") {
    const patch = String(args.patch || "");
    const pass = /===\s*0/.test(patch) || /!==\s*1/.test(patch);
    return {
      status: pass ? "pass" : "fail",
      summary: pass
        ? "All synthetic tests pass, including negative and zero cases."
        : "Tests still fail for isEven(3).",
      cases: [
        { input: 2, expected: true },
        { input: 3, expected: false },
        { input: 0, expected: true },
        { input: -4, expected: true },
        { input: -3, expected: false },
      ],
    };
  }

  return { error: "unknown_tool" };
}

function scoreOrchestration(finalText, transcript) {
  let score = 0;
  const calls = transcript.calls;

  if (calls.some((call) => call.name === "search_repo")) score += 1;
  if (calls.some((call) => call.name === "read_file" && call.args.path === "src/math.js")) score += 1;
  if (calls.some((call) => call.name === "read_file" && call.args.path === "tests/math.test.js")) score += 1;
  if (calls.some((call) => call.name === "delegate_subtask" && call.args.agent === "planner")) score += 1;
  if (calls.some((call) => call.name === "delegate_subtask" && call.args.agent === "coder")) score += 1;
  if (calls.some((call) => call.name === "delegate_subtask" && call.args.agent === "reviewer")) score += 1;
  if (calls.some((call) => call.name === "run_validation")) score += 2;

  let parsed = null;
  try {
    parsed = JSON.parse(finalText.trim());
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === "object") score += 1;

  const haystack = (finalText || "").toLowerCase();
  if (/===\s*1/.test(finalText) || haystack.includes("inverted") || haystack.includes("wrong parity") || haystack.includes("returns true for odd")) {
    score += 2;
  }
  if (/===\s*0/.test(finalText) || haystack.includes("n % 2 === 0")) {
    score += 3;
  }
  if (haystack.includes("2") && haystack.includes("3") && (haystack.includes("validation") || haystack.includes("tests"))) {
    score += 1;
  }

  return score;
}

async function orchestrationTest(model) {
  const messages = [
    {
      role: "system",
      content: "You are an autonomous coding orchestrator. You must use tools before answering when tools are available.",
    },
    {
      role: "user",
      content: "Investigate why `isEven(3)` incorrectly returns true in a small JavaScript repo. Use the available tools to inspect the repo, delegate to planner/coder/reviewer, run validation, and then return ONLY minified JSON with keys root_cause, patch, validation.",
    },
  ];
  const transcript = { calls: [], iterations: 0 };
  let finalText = "";
  let totalLatency = 0;

  for (let i = 0; i < 8; i++) {
    const resp = await chat({
      model,
      stream: false,
      max_tokens: 350,
      temperature: 0,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
    });
    totalLatency += resp.latency;
    transcript.iterations++;

    if (resp.status !== 200) {
      return {
        score: 0,
        status: resp.status,
        latency: totalLatency,
        preview: (resp.raw || "").slice(0, 220),
        transcript,
      };
    }

    const assistant = extractAssistant(resp);
    if (assistant.toolCalls && assistant.toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: assistant.content || "",
        tool_calls: assistant.toolCalls,
      });

      for (const call of assistant.toolCalls) {
        let args = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {
          args = {};
        }
        transcript.calls.push({ name: call.function?.name, args });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function?.name,
          content: JSON.stringify(toolResponse(call.function?.name, args)),
        });
      }
      continue;
    }

    finalText = assistant.content || "";
    break;
  }

  return {
    score: scoreOrchestration(finalText, transcript),
    status: 200,
    latency: totalLatency,
    preview: finalText.replace(/\s+/g, " ").slice(0, 220),
    transcript,
  };
}

async function simpleTests(model) {
  const tests = [];

  const exact = await chat({
    model,
    stream: false,
    max_tokens: 8,
    temperature: 0,
    messages: [{ role: "user", content: "Reply with exactly OK and nothing else." }],
  });
  const exactText = extractAssistant(exact).content;
  tests.push({
    name: "exact",
    score: exact.status === 200 ? scoreExact(exactText) : 0,
    status: exact.status,
    latency: exact.latency,
    preview: exactText.replace(/\s+/g, " ").slice(0, 160),
  });

  const json = await chat({
    model,
    stream: false,
    max_tokens: 80,
    temperature: 0,
    messages: [{ role: "user", content: "Return only minified JSON with keys sum and parity for 17+25." }],
  });
  const jsonText = extractAssistant(json).content;
  tests.push({
    name: "json",
    score: json.status === 200 ? scoreJson(jsonText) : 0,
    status: json.status,
    latency: json.latency,
    preview: jsonText.replace(/\s+/g, " ").slice(0, 160),
  });

  const code = await chat({
    model,
    stream: false,
    max_tokens: 220,
    temperature: 0,
    messages: [{ role: "user", content: "Write only a JavaScript function named fib that returns the nth Fibonacci number iteratively. No explanation." }],
  });
  const codeText = extractAssistant(code).content;
  tests.push({
    name: "code",
    score: code.status === 200 ? scoreCode(codeText) : 0,
    status: code.status,
    latency: code.latency,
    preview: codeText.replace(/\s+/g, " ").slice(0, 160),
  });

  return tests;
}

async function benchmarkModel(model) {
  const simple = await simpleTests(model);
  const orchestration = await orchestrationTest(model);
  const totalScore = simple.reduce((sum, test) => sum + test.score, 0) + orchestration.score;
  const totalLatency = simple.reduce((sum, test) => sum + test.latency, 0) + orchestration.latency;

  return {
    model,
    totalScore,
    totalLatency,
    tests: [
      ...simple,
      {
        name: "orchestration",
        score: orchestration.score,
        status: orchestration.status,
        latency: orchestration.latency,
        preview: orchestration.preview,
        calls: orchestration.transcript.calls.map((call) => `${call.name}:${JSON.stringify(call.args)}`),
      },
    ],
  };
}

async function main() {
  const { baseline, candidates } = getArgs();
  const results = [];

  for (const model of [baseline, ...candidates]) {
    results.push(await benchmarkModel(model));
  }

  const baselineResult = results.find((result) => result.model === baseline);
  const baselineScore = Math.max(1, baselineResult?.totalScore || 1);

  const ranked = results
    .filter((result) => result.model !== baseline)
    .map((result) => ({
      ...result,
      percentOfOpus: Math.round((result.totalScore / baselineScore) * 100),
    }))
    .sort((a, b) => b.percentOfOpus - a.percentOfOpus || b.totalScore - a.totalScore || a.totalLatency - b.totalLatency);

  console.log(JSON.stringify({
    baseline: {
      model: baseline,
      totalScore: baselineScore,
      totalLatency: baselineResult?.totalLatency || 0,
      tests: baselineResult?.tests || [],
    },
    ranked,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
