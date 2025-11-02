/**
 * 工具相关的工具函数
 * 不再硬编码工具列表，从环境变量动态读取
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
