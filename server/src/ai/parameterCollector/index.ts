import { AITool } from '../toolRegistry/index.js';

export class ParameterCollector {
  /**
   * Validates tool arguments. If required parameters are missing based on the schema,
   * returns an error message telling the LLM to prompt the user.
   * Note: This acts as an extra layer of safety. Usually, the LLM itself handles this
   * if the tool parameters are defined carefully with "required" array.
   */
  static validate(tool: AITool, args: any): { valid: boolean; error?: string } {
    const schema = tool.parameters;
    
    if (schema && schema.required && Array.isArray(schema.required)) {
      const missingFields: string[] = [];
      for (const field of schema.required) {
        if (args[field] === undefined || args[field] === null || args[field] === '') {
          missingFields.push(field);
        }
      }
      
      if (missingFields.length > 0) {
        return {
          valid: false,
          error: `Missing required parameters: ${missingFields.join(', ')}. Ask the user to provide ALL of these missing fields in a SINGLE combined response. Do NOT ask for them one by one.`
        };
      }
    }
    
    return { valid: true };
  }
}
