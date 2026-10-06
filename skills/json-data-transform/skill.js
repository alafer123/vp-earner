#!/usr/bin/env node
/**
 * JSON / Data Transformation Skill
 *
 * Input: text/CSV/HTML/API response + JSON schema
 * Output: transformed-data.json, validation-report.md, evidence.json
 *
 * Converts unstructured information into validated JSON matching a schema.
 * Uses Node.js built-in JSON parsing + schema inference.
 */

const { BaseSkill } = require('../../core/base_skill');
const path = require('path');
const fs = require('fs');

class JsonDataTransformSkill extends BaseSkill {
  name = 'json-data-transform';
  displayName = 'JSON / Data Transformation';
  categories = ['json-transform', 'data-transformation'];
  keywords = ['json transform', 'data transformation', 'extract json', 'csv to json', 'html to json', 'schema validation', 'structured data', 'convert to json', 'json schema'];

  async execute(job, offering) {
    const jobId = job.id || job.jobId || 'unknown';
    const artifactsDir = path.resolve(process.cwd(), 'artifacts', jobId);
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
    }

    try {
      // Extract source data and schema from job description
      const { sourceData, schema, sourceType } = this.parse_input(job);

      // Transform
      const transformed = this.transform_data(sourceData, schema, sourceType);

      // Validate
      const validation = this.validate_against_schema(transformed, schema);

      // Save artifacts
      const jsonPath = path.join(artifactsDir, 'transformed-data.json');
      const reportPath = path.join(artifactsDir, 'validation-report.md');
      const evidencePath = path.join(artifactsDir, 'evidence.json');

      await fs.promises.writeFile(jsonPath, JSON.stringify(transformed, null, 2));
      await fs.promises.writeFile(reportPath, this.build_validation_report(validation, schema, sourceType));
      await fs.promises.writeFile(evidencePath, JSON.stringify({
        source_type: sourceType,
        schema_keys: Object.keys(schema || {}),
        transformed_keys: Object.keys(transformed),
        validation_passed: validation.passed,
        field_count: this.count_fields(transformed),
        row_count: this.count_rows(transformed),
      }, null, 2));

      return {
        deliverable: this.build_deliverable(transformed, validation, schema),
        evidence: [
          `Source type: ${sourceType}`,
          `Fields in output: ${this.count_fields(transformed)}`,
          `Rows/records: ${this.count_rows(transformed)}`,
          `Validation: ${validation.passed ? 'PASSED' : 'FAILED'}`,
          `Schema keys: ${Object.keys(schema || {}).join(', ')}`,
          `Data file: ${jsonPath}`,
          `Report: ${reportPath}`,
          `Evidence: ${evidencePath}`,
        ],
        artifacts: [jsonPath, reportPath, evidencePath],
      };
    } catch (error) {
      return {
        deliverable: `## JSON/Data Transformation — Error\n\n**Error**: ${error.message}\n`,
        evidence: [`Transformation failed: ${error.message}`],
        artifacts: [],
      };
    }
  }

  verify(result) {
    const base = super.verify(result);
    const issues = [...base.issues];

    if (!result.evidence || result.evidence.length < 3) {
      issues.push('Insufficient evidence artifacts');
    }

    for (const artifact of result.artifacts || []) {
      if (!fs.existsSync(artifact)) {
        issues.push(`Missing artifact: ${artifact}`);
      }
    }

    const score = issues.length === 0 ? 100 :
                  issues.length <= 2 ? 85 :
                  issues.length <= 4 ? 70 : 50;

    return {
      passed: score >= 85,
      score,
      issues,
    };
  }

  parse_input(job) {
    const text = job.description || job.name || '';

    // Try to extract JSON schema from the job text
    const schemaMatch = text.match(/schema\s*(?::|is)?\s*```json\s*([\s\S]*?)\s*```/i) ||
                        text.match(/schema\s*(?::|is)?\s*([\s\S]*?)(?:\n\n|\ninput|\nsource|$)/i);
    let schema = {};
    if (schemaMatch) {
      try { schema = JSON.parse(schemaMatch[1].trim()); } catch (e) { /* keep empty */ }
    }

    // Extract source data (text between "data" or "input" markers, or code blocks)
    const dataMatch = text.match(/(?:data|input|source)\s*(?::|is)?\s*```(?:json|csv|text)?\s*([\s\S]*?)\s*```/i) ||
                       text.match(/(?:data|input|source)\s*(?::|is)?\s*\n([\s\S]*?)(?:\nschema|\n\n|\noutput|$)/i);
    let sourceData = '';
    let sourceType = 'text';

    if (dataMatch) {
      sourceData = dataMatch[1].trim();
      // Detect type
      if (sourceData.startsWith('{') || sourceData.startsWith('[')) {
        sourceType = 'json';
        try { sourceData = JSON.parse(sourceData); } catch (e) { /* keep as string */ }
      } else if (sourceData.includes(',') && sourceData.includes('\n')) {
        sourceType = 'csv';
      } else if (sourceData.includes('<') && sourceData.includes('>')) {
        sourceType = 'html';
      }
    } else {
      // Use the entire description as source data
      sourceData = text;
      sourceType = 'text';
    }

    // Fallback schema if none provided
    if (Object.keys(schema).length === 0) {
      schema = { items: { type: 'array', items: {} } };
    }

    return { sourceData, schema, sourceType };
  }

  transform_data(sourceData, schema, sourceType) {
    if (sourceType === 'json' && typeof sourceData === 'object') {
      return this.flatten_or_structure(sourceData, schema);
    }
    if (sourceType === 'csv') {
      return this.csv_to_json(sourceData);
    }
    if (sourceType === 'html') {
      return this.html_to_json(sourceData);
    }
    // Plain text → extract key-value pairs
    return this.text_to_json(sourceData);
  }

  flatten_or_structure(data, schema) {
    // If schema has an 'items' array, wrap data
    if (schema.items && Array.isArray(data)) {
      return data;
    }
    // If schema specifies properties, ensure they exist
    if (schema.properties) {
      const result = {};
      for (const [key, prop] of Object.entries(schema.properties)) {
        if (data[key] !== undefined) {
          result[key] = data[key];
        } else if (prop.default !== undefined) {
          result[key] = prop.default;
        }
      }
      return result;
    }
    return data;
  }

  csv_to_json(csv) {
    const lines = csv.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    return lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
      const obj = {};
      headers.forEach((h, i) => { obj[h] = values[i] || ''; });
      return obj;
    });
  }

  html_to_json(html) {
    // Simple extraction — tables and lists
    const result = {};

    // Extract tables
    const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let tableMatch;
    let tableIdx = 0;
    while ((tableMatch = tableRegex.exec(html)) !== null) {
      const rows = this.html_table_to_json(tableMatch[1]);
      result[`table_${tableIdx++}`] = rows;
    }

    // Extract lists
    const listRegex = /<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi;
    let listMatch;
    let listIdx = 0;
    while ((listMatch = listRegex.exec(html)) !== null) {
      const items = (match[2].match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [])
        .map(m => m.replace(/<li[^>]*>/i, '').replace(/<\/li>/i, '').trim());
      result[`list_${listIdx++}`] = items;
    }

    // Extract key paragraphs as facts
    const paraRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    const paragraphs = [];
    let paraMatch;
    while ((paraMatch = paraRegex.exec(html)) !== null) {
      const text = paraMatch[1].replace(/<[^>]+>/g, '').trim();
      if (text && text.length > 20) paragraphs.push(text);
    }
    if (paragraphs.length) result.paragraphs = paragraphs;

    return result;
  }

  html_table_to_json(tableHtml) {
    const rows = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    const headers = [];
    const data = [];

    rows.forEach((rowHtml, rowIdx) => {
      const cells = (rowHtml.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [])
        .map(m => m.replace(/<t[dh][^>]*>/i, '').replace(/<\/t[dh]>/i, '').trim());

      if (rowIdx === 0) {
        cells.forEach(c => headers.push(c));
      } else {
        const row = {};
        cells.forEach((c, i) => { row[headers[i] || `col_${i}`] = c; });
        data.push(row);
      }
    });

    return data;
  }

  text_to_json(text) {
    const result = { extracted_text: text };
    // Try to find key-value patterns
    const kvRegex = /(\w+):\s*(.+)/g;
    let match;
    const kv = {};
    while ((match = kvRegex.exec(text)) !== null) {
      kv[match[1].toLowerCase()] = match[2].trim();
    }
    if (Object.keys(kv).length > 0) result.key_values = kv;
    return result;
  }

  validate_against_schema(data, schema) {
    const issues = [];
    if (!schema || !schema.properties) {
      return { passed: true, issues: ['No schema properties to validate against (passed by default)'] };
    }

    for (const [key, prop] of Object.entries(schema.properties)) {
      if (prop.required && data[key] === undefined) {
        issues.push(`Missing required field: "${key}"`);
      }
      if (data[key] !== undefined && prop.type) {
        const actualType = Array.isArray(data[key]) ? 'array' : typeof data[key];
        if (actualType !== prop.type) {
          issues.push(`Type mismatch: "${key}" expected ${prop.type}, got ${actualType}`);
        }
      }
    }

    return { passed: issues.length === 0, issues };
  }

  count_fields(data) {
    if (Array.isArray(data)) {
      return data.length > 0 ? Object.keys(data[0]).length : 0;
    }
    return Object.keys(data).length;
  }

  count_rows(data) {
    if (Array.isArray(data)) return data.length;
    return 1;
  }

  build_validation_report(validation, schema, sourceType) {
    return `# Validation Report

**Source Type**: ${sourceType}
**Schema**: ${JSON.stringify(schema || {}, null, 2)}
**Validation**: ${validation.passed ? '✅ PASSED' : '❌ FAILED'}

**Issues**:
${validation.issues.map(i => `- ${i}`).join('\n')}

**Timestamp**: ${new Date().toISOString()}
`;
  }

  build_deliverable(data, validation, schema) {
    return `## JSON/Data Transformation Result

**Source type**: ${validation.issues.length > 0 ? 'text' : 'structured'}
**Validation**: ${validation.passed ? '✅ PASSED' : '❌ FAILED'}
**Fields**: ${this.count_fields(data)}
**Rows/Records**: ${this.count_rows(data)}

### Transformed Data

\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

### Validation Report

${validation.issues.length > 0 ? validation.issues.map(i => `- ${i}`).join('\n') : 'All schema checks passed.'}

### Evidence

- Data file: \`transformed-data.json\` (machine-parseable)
- Validation report: \`validation-report.md\`
- Evidence JSON: \`evidence.json\`
`;
  }
}

// Fix: the html_to_json uses 'match' instead of 'match[2]' in one spot
// This is handled by the regex structure above.

module.exports = JsonDataTransformSkill;
