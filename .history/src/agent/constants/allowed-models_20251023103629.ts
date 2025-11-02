/**
 * 模型工具函数
 * 不再硬编码模型列表，而是从 Agent API 动态获取可用模型
 */

/**
 * 获取模型的简短显示名称
 * @param modelName 完整的模型名称
 * @returns 简短的显示名称
 */
export function getModelDisplayName(modelName: string): string {
  const parts = modelName.split('/');
  return parts.length > 1 ? parts[1] : modelName;
}
