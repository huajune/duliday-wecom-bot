/**
 * 消息拆分工具类
 * 用于将长消息按换行符拆分成多个片段
 */
export class MessageSplitter {
  /**
   * 将消息文本按换行符拆分成多个片段
   * @param text 原始消息文本
   * @returns 拆分后的消息片段数组（已过滤空行）
   */
  static splitByNewlines(text: string): string[] {
    if (!text || typeof text !== 'string') {
      return [];
    }

    // 按换行符拆分（支持 \n 和 \r\n）
    const segments = text.split(/\r?\n/);

    // 过滤掉空行和只包含空白字符的行
    const nonEmptySegments = segments
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);

    return nonEmptySegments;
  }

  /**
   * 检查消息是否需要拆分
   * @param text 消息文本
   * @returns 是否包含换行符
   */
  static needsSplit(text: string): boolean {
    if (!text || typeof text !== 'string') {
      return false;
    }
    return /\r?\n/.test(text);
  }

  /**
   * 获取拆分后的片段数量
   * @param text 消息文本
   * @returns 拆分后的片段数量
   */
  static getSegmentCount(text: string): number {
    return this.splitByNewlines(text).length;
  }
}
