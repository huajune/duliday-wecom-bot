import { MessageSplitter } from './message-splitter.util';

describe('MessageSplitter', () => {
  describe('splitByNewlines', () => {
    it('应该按换行符拆分消息', () => {
      const text = '第一行\n第二行\n第三行';
      const result = MessageSplitter.splitByNewlines(text);
      expect(result).toEqual(['第一行', '第二行', '第三行']);
    });

    it('应该处理 Windows 风格的换行符', () => {
      const text = '第一行\r\n第二行\r\n第三行';
      const result = MessageSplitter.splitByNewlines(text);
      expect(result).toEqual(['第一行', '第二行', '第三行']);
    });

    it('应该过滤掉空行', () => {
      const text = '第一行\n\n第二行\n   \n第三行';
      const result = MessageSplitter.splitByNewlines(text);
      expect(result).toEqual(['第一行', '第二行', '第三行']);
    });

    it('应该处理只有空格的行', () => {
      const text = '第一行\n   \n第二行';
      const result = MessageSplitter.splitByNewlines(text);
      expect(result).toEqual(['第一行', '第二行']);
    });

    it('应该去除每行前后的空格', () => {
      const text = '  第一行  \n  第二行  \n  第三行  ';
      const result = MessageSplitter.splitByNewlines(text);
      expect(result).toEqual(['第一行', '第二行', '第三行']);
    });

    it('对于空字符串应该返回空数组', () => {
      const result = MessageSplitter.splitByNewlines('');
      expect(result).toEqual([]);
    });

    it('对于只包含换行符的字符串应该返回空数组', () => {
      const result = MessageSplitter.splitByNewlines('\n\n\n');
      expect(result).toEqual([]);
    });

    it('对于不包含换行符的字符串应该返回包含该字符串的数组', () => {
      const text = '这是一条单行消息';
      const result = MessageSplitter.splitByNewlines(text);
      expect(result).toEqual(['这是一条单行消息']);
    });

    it('应该处理 null 和 undefined', () => {
      expect(MessageSplitter.splitByNewlines(null as any)).toEqual([]);
      expect(MessageSplitter.splitByNewlines(undefined as any)).toEqual([]);
    });
  });

  describe('needsSplit', () => {
    it('包含换行符时应该返回 true', () => {
      expect(MessageSplitter.needsSplit('第一行\n第二行')).toBe(true);
      expect(MessageSplitter.needsSplit('第一行\r\n第二行')).toBe(true);
    });

    it('不包含换行符时应该返回 false', () => {
      expect(MessageSplitter.needsSplit('这是一条单行消息')).toBe(false);
    });

    it('对于空字符串应该返回 false', () => {
      expect(MessageSplitter.needsSplit('')).toBe(false);
    });

    it('对于 null 和 undefined 应该返回 false', () => {
      expect(MessageSplitter.needsSplit(null as any)).toBe(false);
      expect(MessageSplitter.needsSplit(undefined as any)).toBe(false);
    });
  });

  describe('getSegmentCount', () => {
    it('应该返回正确的片段数量', () => {
      expect(MessageSplitter.getSegmentCount('第一行\n第二行\n第三行')).toBe(3);
    });

    it('应该过滤空行后返回正确的数量', () => {
      expect(MessageSplitter.getSegmentCount('第一行\n\n第二行\n第三行')).toBe(3);
    });

    it('对于单行消息应该返回 1', () => {
      expect(MessageSplitter.getSegmentCount('这是一条单行消息')).toBe(1);
    });

    it('对于空字符串应该返回 0', () => {
      expect(MessageSplitter.getSegmentCount('')).toBe(0);
    });
  });

  describe('实际应用场景测试', () => {
    it('应该正确拆分花卷Agent的多段回复', () => {
      const agentReply = `您好！很高兴为您服务。

我们目前有以下几个岗位：

1. 前端工程师 - React
2. 后端工程师 - Node.js
3. 产品经理

请问您对哪个岗位感兴趣？`;

      const segments = MessageSplitter.splitByNewlines(agentReply);

      expect(segments.length).toBe(6);
      expect(segments[0]).toBe('您好！很高兴为您服务。');
      expect(segments[1]).toBe('我们目前有以下几个岗位：');
      expect(segments[2]).toBe('1. 前端工程师 - React');
      expect(segments[3]).toBe('2. 后端工程师 - Node.js');
      expect(segments[4]).toBe('3. 产品经理');
      expect(segments[5]).toBe('请问您对哪个岗位感兴趣？');
    });
  });
});
