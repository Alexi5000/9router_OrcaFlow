function extractText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join(" ");
  if (!value || typeof value !== "object") return "";
  if (typeof value.text === "string") return value.text;
  if (typeof value.content === "string") return value.content;
  if (Array.isArray(value.content)) return value.content.map(extractText).filter(Boolean).join(" ");
  if (Array.isArray(value.parts)) return value.parts.map(extractText).filter(Boolean).join(" ");
  if (Array.isArray(value.input)) return value.input.map(extractText).filter(Boolean).join(" ");
  return "";
}

export function extractPromptText(body = {}) {
  const segments = [];

  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      segments.push(extractText(message?.content));
    }
  }

  if (Array.isArray(body.input)) {
    for (const input of body.input) {
      segments.push(extractText(input));
    }
  } else if (typeof body.input === "string") {
    segments.push(body.input);
  }

  if (typeof body.prompt === "string") {
    segments.push(body.prompt);
  }

  return segments.filter(Boolean).join(" ").toLowerCase();
}

const PLANNING_PATTERNS = [
  /\bplan\b/g,
  /\bswarm\b/g,
  /\borchestrat(?:e|ion)\b/g,
  /\bspawn(?:_agent| agent| agents)?\b/g,
  /\bagent(?:s)?\b/g,
  /\bdecompos(?:e|ition)\b/g,
  /\bverification\b/g,
  /\bverify\b/g,
  /\bcheck(?:s)?\b/g,
  /\bstrategy\b/g,
  /\barchitecture\b/g,
  /\bcoordina(?:te|tion)\b/g,
  /\bbreadth[\s-]?first\b/g,
  /\bprincipal engineer\b/g,
  /\bdeliverable(?:s)?\b/g,
];

const IMPLEMENTATION_PATTERNS = [
  /\bimplement\b/g,
  /\bwrite\b/g,
  /\bpatch\b/g,
  /\bfix\b/g,
  /\brefactor\b/g,
  /\bcode(?:gen)?\b/g,
  /\bfunction\b/g,
  /\bcomponent\b/g,
  /\bmodule\b/g,
  /\btest(?:s)?\b/g,
  /\bdebug\b/g,
  /\bship\b/g,
  /\bbuild\b/g,
];

function countPatternMatches(text, patterns) {
  return patterns.reduce((total, pattern) => total + (text.match(pattern)?.length || 0), 0);
}

export function classifyDeepseekSwarmIntent(body = {}) {
  const text = extractPromptText(body);
  const planningScore =
    countPatternMatches(text, PLANNING_PATTERNS) +
    (Array.isArray(body.tools) && body.tools.length > 0 ? 2 : 0);
  const implementationScore = countPatternMatches(text, IMPLEMENTATION_PATTERNS);

  return planningScore > implementationScore ? "planning" : "implementation";
}

export function shapeDeepseekSwarmCombo(combo, body = {}) {
  if (!combo || combo.routingStrategy !== "deepseek-swarm" || !Array.isArray(combo.tiers)) {
    return combo;
  }

  const preference = classifyDeepseekSwarmIntent(body);
  const preferredOrder = preference === "planning"
    ? ["thinking-family", "coding-family", "paid-continuity"]
    : ["coding-family", "thinking-family", "paid-continuity"];

  const tiersByName = new Map(
    combo.tiers
      .filter((tier) => tier?.name)
      .map((tier) => [tier.name, tier])
  );

  const orderedTiers = preferredOrder
    .map((name) => tiersByName.get(name))
    .filter(Boolean);

  if (orderedTiers.length === 0) {
    return combo;
  }

  const orderedModels = orderedTiers.flatMap((tier) => Array.isArray(tier.models) ? tier.models : []);

  return {
    ...combo,
    tiers: orderedTiers,
    models: orderedModels,
    requestPreference: preference,
  };
}
