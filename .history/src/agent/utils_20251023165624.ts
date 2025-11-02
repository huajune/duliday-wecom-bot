/**
 * Agent 模块实用工具函数
 */

/**
 * 解析环境变量中的工具列表
 * @param toolsString 逗号分隔的工具字符串，例如: "tool1,tool2,tool3"
 * @returns 工具数组
 */
export function parseToolsFromEnv(toolsString: string | undefined): string[] {
  if (!toolsString || toolsString.trim() === '') {
    return [];
  }

  return toolsString
    .split(',')
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
}

/**
 * 获取模型的简短显示名称
 * @param modelName 完整的模型名称
 * @returns 简短的显示名称
 */
export function getModelDisplayName(modelName: string): string {
  const parts = modelName.split('/');
  return parts.length > 1 ? parts[1] : modelName;
}
