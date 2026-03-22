import { cleanJSONSchemaForAntigravity } from "./geminiHelper.js";

export const OPENAI_RESPONSES_SCHEMA_ERROR_CODE =
  "openai_responses_schema_incompatible";

const PLACEHOLDER_PROPERTY_NAME = "_hint";
const PLACEHOLDER_PROPERTY = {
  type: "string",
  description:
    "Optional placeholder field for tools that accept no structured arguments.",
};

function deepClone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isClaudeNativeToolType(type) {
  if (typeof type !== "string") return false;
  return (
    /^web_search_\d{8}$/.test(type) ||
    /^computer_\d{8}$/.test(type) ||
    /^text_editor_\d{8}$/.test(type) ||
    /^bash_\d{8}$/.test(type)
  );
}

function inspectSchemaFeatures(schema, flags = {}) {
  if (!isPlainObject(schema)) return flags;

  if (Array.isArray(schema.type)) flags.hadTypeArray = true;
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0)
    flags.hadUnionLike = true;
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0)
    flags.hadUnionLike = true;
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0)
    flags.hadUnionLike = true;

  const isObjectLike =
    schema.type === "object" || schema.properties || schema.required;
  if (isObjectLike) {
    const propCount = isPlainObject(schema.properties)
      ? Object.keys(schema.properties).length
      : 0;
    if (propCount === 0) flags.hadEmptyObjectSchema = true;
  }

  for (const value of Object.values(schema)) {
    if (Array.isArray(value)) {
      for (const item of value) inspectSchemaFeatures(item, flags);
    } else if (isPlainObject(value)) {
      inspectSchemaFeatures(value, flags);
    }
  }

  return flags;
}

function normalizeRequiredArray(schema) {
  if (!Array.isArray(schema.required)) {
    delete schema.required;
    return;
  }

  const propertyNames = isPlainObject(schema.properties)
    ? Object.keys(schema.properties)
    : [];
  const valid = schema.required.filter(
    (key, index, arr) =>
      typeof key === "string" &&
      propertyNames.includes(key) &&
      arr.indexOf(key) === index,
  );

  if (valid.length > 0) {
    schema.required = valid;
  } else {
    delete schema.required;
  }
}

function maybeRemovePlaceholderRequirement(schema) {
  if (!isPlainObject(schema.properties)) return;
  const propertyKeys = Object.keys(schema.properties);
  if (
    propertyKeys.length !== 1 ||
    propertyKeys[0] !== PLACEHOLDER_PROPERTY_NAME
  )
    return;
  const onlyProp = schema.properties[PLACEHOLDER_PROPERTY_NAME];
  if (
    !onlyProp ||
    onlyProp.type !== PLACEHOLDER_PROPERTY.type ||
    onlyProp.description !== PLACEHOLDER_PROPERTY.description
  ) {
    return;
  }

  if (
    Array.isArray(schema.required) &&
    schema.required.length === 1 &&
    schema.required[0] === PLACEHOLDER_PROPERTY_NAME
  ) {
    delete schema.required;
  }
}

function normalizeGeminiPlaceholder(schema, flags) {
  if (!isPlainObject(schema.properties)) return;
  const propertyKeys = Object.keys(schema.properties);
  if (propertyKeys.length !== 1 || propertyKeys[0] !== "reason") return;

  const onlyProp = schema.properties.reason;
  if (
    !onlyProp ||
    onlyProp.type !== "string" ||
    onlyProp.description !==
      "Brief explanation of why you are calling this tool"
  ) {
    return;
  }

  delete schema.properties.reason;
  schema.properties[PLACEHOLDER_PROPERTY_NAME] = { ...PLACEHOLDER_PROPERTY };
  if (Array.isArray(schema.required)) {
    schema.required = schema.required.map((key) =>
      key === "reason" ? PLACEHOLDER_PROPERTY_NAME : key,
    );
  }
  flags.addedPlaceholder = true;
}

function normalizeObjectSchemas(schema, flags = {}) {
  if (!isPlainObject(schema)) return;

  const isObjectLike =
    schema.type === "object" || schema.properties || schema.required;
  if (isObjectLike) {
    schema.type = "object";
    if (!isPlainObject(schema.properties)) {
      schema.properties = {};
    }

    normalizeGeminiPlaceholder(schema, flags);

    if (Object.keys(schema.properties).length === 0) {
      schema.properties[PLACEHOLDER_PROPERTY_NAME] = {
        ...PLACEHOLDER_PROPERTY,
      };
      flags.addedPlaceholder = true;
    }

    normalizeRequiredArray(schema);
    maybeRemovePlaceholderRequirement(schema);
  }

  if (
    schema.type === "array" &&
    schema.items &&
    !isPlainObject(schema.items) &&
    !Array.isArray(schema.items)
  ) {
    delete schema.items;
  }

  const nextValues = [];
  if (isPlainObject(schema.properties)) {
    nextValues.push(...Object.values(schema.properties));
  }
  if (schema.items) nextValues.push(schema.items);

  for (const value of Object.values(schema)) {
    if (value === schema.properties || value === schema.items) continue;
    nextValues.push(value);
  }

  for (const value of nextValues) {
    if (Array.isArray(value)) {
      for (const item of value) {
        normalizeObjectSchemas(item, flags);
      }
    } else if (isPlainObject(value)) {
      normalizeObjectSchemas(value, flags);
    }
  }
}

function validateOpenAIResponsesSchema(schema, { strict = false } = {}) {
  const issues = [];

  function walk(node, path, isRoot = false) {
    if (!isPlainObject(node)) {
      issues.push(`${path} must be an object schema`);
      return;
    }

    if (Array.isArray(node.type)) {
      issues.push(`${path}.type must not be an array`);
    }

    if (node.anyOf || node.oneOf || node.allOf) {
      issues.push(`${path} contains unsupported schema composition`);
    }

    const isObjectLike =
      isRoot || node.type === "object" || node.properties || node.required;
    if (isObjectLike) {
      if (node.type !== "object") {
        issues.push(`${path}.type must be "object"`);
      }

      if (!isPlainObject(node.properties)) {
        issues.push(`${path}.properties must be an object`);
      } else if (strict && Object.keys(node.properties).length === 0) {
        issues.push(`${path}.properties must not be empty in strict mode`);
      }

      if (node.required !== undefined) {
        if (!Array.isArray(node.required)) {
          issues.push(`${path}.required must be an array`);
        } else if (isPlainObject(node.properties)) {
          for (const key of node.required) {
            if (!Object.prototype.hasOwnProperty.call(node.properties, key)) {
              issues.push(
                `${path}.required contains unknown property "${key}"`,
              );
            }
          }
        }
      }
    }

    if (
      node.type === "array" &&
      node.items !== undefined &&
      !isPlainObject(node.items) &&
      !Array.isArray(node.items)
    ) {
      issues.push(`${path}.items must be an object schema`);
    }

    if (isPlainObject(node.properties)) {
      for (const [key, child] of Object.entries(node.properties)) {
        walk(child, `${path}.properties.${key}`);
      }
    }

    if (isPlainObject(node.items)) {
      walk(node.items, `${path}.items`);
    }
  }

  walk(schema, "$", true);
  return issues;
}

export function sanitizeOpenAIResponsesParameters(
  parameters,
  strictRequested = false,
) {
  const originalSchema = isPlainObject(parameters)
    ? deepClone(parameters)
    : { type: "object", properties: {} };
  const flags = inspectSchemaFeatures(originalSchema, {});
  const cleaned = cleanJSONSchemaForAntigravity(originalSchema);

  if (!isPlainObject(cleaned)) {
    return {
      compatible: false,
      parameters: {
        type: "object",
        properties: {
          [PLACEHOLDER_PROPERTY_NAME]: { ...PLACEHOLDER_PROPERTY },
        },
      },
      strict: false,
      downgraded: false,
      issues: ["$ must be an object schema"],
    };
  }

  normalizeObjectSchemas(cleaned, flags);

  const strictIssues = validateOpenAIResponsesSchema(cleaned, { strict: true });
  const strictCompatible = strictIssues.length === 0;
  const strictSemanticRisk = flags.hadUnionLike || flags.hadTypeArray;
  const canKeepStrict =
    strictRequested && strictCompatible && !strictSemanticRisk;

  if (canKeepStrict) {
    return {
      compatible: true,
      parameters: cleaned,
      strict: true,
      downgraded: false,
      issues: [],
    };
  }

  const nonStrictIssues = validateOpenAIResponsesSchema(cleaned, {
    strict: false,
  });
  if (nonStrictIssues.length === 0) {
    return {
      compatible: true,
      parameters: cleaned,
      strict: false,
      downgraded: strictRequested === true,
      issues: strictRequested ? strictIssues : [],
    };
  }

  return {
    compatible: false,
    parameters: cleaned,
    strict: false,
    downgraded: false,
    issues: nonStrictIssues,
  };
}

function sanitizeResponseFunctionTool(tool) {
  if (!tool || tool.type !== "function") {
    return { tool, incompatible: null };
  }

  const functionTool =
    tool.function && typeof tool.function === "object" ? tool.function : null;
  const toolName =
    typeof tool.name === "string"
      ? tool.name.trim()
      : typeof functionTool?.name === "string"
        ? functionTool.name.trim()
        : "";
  if (!toolName) {
    return {
      tool: null,
      incompatible: {
        name: "(unnamed)",
        issues: ["function tools must have a non-empty name"],
      },
    };
  }

  const result = sanitizeOpenAIResponsesParameters(
    tool.parameters ?? functionTool?.parameters,
    tool.strict === true || functionTool?.strict === true,
  );
  if (!result.compatible) {
    return {
      tool: null,
      incompatible: {
        name: toolName,
        issues: result.issues,
      },
    };
  }

  return {
    tool: {
      type: "function",
      name: toolName,
      description:
        typeof tool.description === "string"
          ? tool.description
          : functionTool?.description,
      parameters: result.parameters,
      strict: result.strict,
    },
    incompatible: null,
  };
}

function sanitizeNonFunctionTool(tool) {
  if (!tool || tool.type === "function") {
    return { tool, incompatible: null };
  }

  if (isClaudeNativeToolType(tool.type)) {
    return {
      tool: null,
      incompatible: {
        name: tool.name || tool.type,
        issues: [
          `tool type "${tool.type}" is Claude-native and not compatible with OpenAI Responses providers`,
        ],
      },
    };
  }

  return { tool, incompatible: null };
}

export function sanitizeOpenAIResponsesTools(tools) {
  if (!Array.isArray(tools)) {
    return { tools, incompatibleTools: [] };
  }

  const incompatibleTools = [];
  const sanitizedTools = [];

  for (const tool of tools) {
    if (tool?.type && tool.type !== "function") {
      const { tool: sanitizedTool, incompatible } =
        sanitizeNonFunctionTool(tool);
      if (incompatible) {
        incompatibleTools.push(incompatible);
        continue;
      }
      sanitizedTools.push(sanitizedTool);
      continue;
    }

    const { tool: sanitizedTool, incompatible } =
      sanitizeResponseFunctionTool(tool);
    if (incompatible) {
      incompatibleTools.push(incompatible);
      continue;
    }
    sanitizedTools.push(sanitizedTool);
  }

  return {
    tools: sanitizedTools,
    incompatibleTools,
  };
}

export function attachOpenAIResponsesSchemaIncompatibility(
  result,
  incompatibleTools,
) {
  if (!Array.isArray(incompatibleTools) || incompatibleTools.length === 0) {
    delete result._schemaIncompatibility;
    return result;
  }

  const toolSummary = incompatibleTools
    .map((tool) => `${tool.name}: ${tool.issues.join("; ")}`)
    .join(" | ");

  result._schemaIncompatibility = {
    code: OPENAI_RESPONSES_SCHEMA_ERROR_CODE,
    message: `OpenAI Responses tool schema incompatible: ${toolSummary}`,
    tools: incompatibleTools,
  };

  return result;
}

export function sanitizeOpenAIResponsesRequestBody(body) {
  if (!body || !Array.isArray(body.tools)) {
    return body;
  }

  const result = { ...body };
  const existingIncompatibility = result._schemaIncompatibility;
  const { tools, incompatibleTools } = sanitizeOpenAIResponsesTools(
    result.tools,
  );
  result.tools = tools;
  if (existingIncompatibility && incompatibleTools.length === 0) {
    result._schemaIncompatibility = existingIncompatibility;
    return result;
  }
  return attachOpenAIResponsesSchemaIncompatibility(result, incompatibleTools);
}
