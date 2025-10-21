import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  ApiResponse,
  ChatRequest,
  ChatResponse,
  SimpleMessage,
  SSEEventData,
} from './dto/chat-request.dto';
import { ConversationService } from '../common/conversation';

/**
 * Agent 服务
 * 用于调用 agent-computer-user 项目的 /api/v1/chat 接口
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly httpClient: AxiosInstance;
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly defaultModel: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly conversationService: ConversationService,
  ) {
    // 从环境变量读取配置
    this.apiKey = this.configService.get<string>('AGENT_API_KEY', 'test-token');
    this.baseURL = this.configService.get<string>(
      'AGENT_API_BASE_URL',
      'http://localhost:3000/api/v1',
    );
    this.defaultModel = this.configService.get<string>(
      'AGENT_DEFAULT_MODEL',
      'anthropic/claude-3-7-sonnet-20250219',
    );

    this.logger.log(`初始化 Agent API 客户端: ${this.baseURL}`);

    // 创建 axios 实例
    this.httpClient = axios.create({
      baseURL: this.baseURL,
      timeout: 60000, // 60秒超时，AI 生成可能需要较长时间
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    // 请求拦截器
    this.httpClient.interceptors.request.use(
      (config) => {
        this.logger.log(`[Agent API] 发送请求: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        this.logger.error('[Agent API] 请求错误:', error);
        return Promise.reject(error);
      },
    );

    // 响应拦截器
    this.httpClient.interceptors.response.use(
      (response) => {
        this.logger.log(`[Agent API] 收到响应: ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        if (error.response) {
          this.logger.error(`[Agent API] 响应错误 ${error.response.status}:`, error.response.data);
        } else if (error.request) {
          this.logger.error('[Agent API] 无响应:', error.message);
        } else {
          this.logger.error('[Agent API] 请求配置错误:', error.message);
        }
        return Promise.reject(error);
      },
    );
  }

  /**
   * 调用 /api/v1/chat 接口（非流式）
   * 自动管理会话历史
   */
  async chat(params: {
    conversationId: string;
    userMessage: string;
    model?: string;
    systemPrompt?: string;
    promptType?: string;
    allowedTools?: string[];
    context?: any;
    toolContext?: any;
  }): Promise<ChatResponse> {
    const {
      conversationId,
      userMessage,
      model = this.defaultModel,
      systemPrompt,
      promptType,
      allowedTools,
      context,
      toolContext,
    } = params;

    try {
      // 验证用户消息不为空
      if (!userMessage || userMessage.trim() === '') {
        throw new Error('用户消息内容不能为空');
      }

      // 获取会话历史
      const history = this.conversationService.getHistory(conversationId);

      // 添加用户消息到历史
      const userMsg: SimpleMessage = { role: 'user', content: userMessage };
      this.conversationService.addMessage(conversationId, userMsg);

      // 构建请求（只添加有值的可选字段）
      const chatRequest: ChatRequest = {
        model,
        messages: [...history, userMsg],
        stream: false,
      };

      // 只添加有值的可选字段
      if (systemPrompt) chatRequest.systemPrompt = systemPrompt;
      if (promptType) chatRequest.promptType = promptType as any;
      if (allowedTools && allowedTools.length > 0) chatRequest.allowedTools = allowedTools;
      if (context && Object.keys(context).length > 0) chatRequest.context = context;
      if (toolContext && Object.keys(toolContext).length > 0) chatRequest.toolContext = toolContext;

      this.logger.log(`调用 /api/v1/chat (非流式)，会话: ${conversationId}`);
      this.logger.log('发送给 Agent 的请求体:', JSON.stringify(chatRequest, null, 2));

      // 发送请求
      const response = await this.httpClient.post<ApiResponse<ChatResponse>>('/chat', chatRequest);

      // 检查 API 响应是否成功
      if (!response.data.success) {
        throw new Error(`API 返回失败: ${response.data.error || '未知错误'}`);
      }

      const chatResponse = response.data.data;

      // 添加助手回复到历史
      if (chatResponse.messages && chatResponse.messages.length > 0) {
        const assistantMessages = chatResponse.messages.filter((m) => m.role === 'assistant');
        this.conversationService.addMessages(conversationId, assistantMessages);
      }

      this.logger.log(`AI 回复生成成功，会话: ${conversationId}`);
      return chatResponse;
    } catch (error) {
      this.logger.error(`调用 /api/v1/chat 失败，会话: ${conversationId}`, error);
      throw error;
    }
  }

  /**
   * 调用 /api/v1/chat 接口（流式）
   * 返回 SSE 事件流
   */
  async chatStream(params: {
    conversationId: string;
    userMessage: string;
    model?: string;
    systemPrompt?: string;
    promptType?: string;
    allowedTools?: string[];
    context?: any;
    toolContext?: any;
    onTextDelta?: (delta: string) => void;
    onToolCall?: (toolName: string, args: any) => void;
    onComplete?: (fullText: string) => void;
    onError?: (error: any) => void;
  }): Promise<string> {
    const {
      conversationId,
      userMessage,
      model = this.defaultModel,
      systemPrompt,
      promptType,
      allowedTools,
      context,
      toolContext,
      onTextDelta,
      onToolCall,
      onComplete,
      onError,
    } = params;

    try {
      // 验证用户消息不为空
      if (!userMessage || userMessage.trim() === '') {
        throw new Error('用户消息内容不能为空');
      }

      // 获取会话历史
      const history = this.conversationService.getHistory(conversationId);

      // 添加用户消息到历史
      const userMsg: SimpleMessage = { role: 'user', content: userMessage };
      this.conversationService.addMessage(conversationId, userMsg);

      // 构建请求
      const chatRequest: ChatRequest = {
        model,
        messages: [...history, userMsg],
        stream: true,
        systemPrompt,
        promptType: promptType as any,
        allowedTools,
        context,
        toolContext,
      };

      this.logger.log(`调用 /api/v1/chat (流式)，会话: ${conversationId}`);
      this.logger.log('发送给 Agent 的请求体:', JSON.stringify(chatRequest, null, 2));

      // 发送流式请求
      const response = await this.httpClient.post('/chat', chatRequest, {
        responseType: 'stream',
        headers: {
          Accept: 'text/event-stream',
        },
      });

      let fullText = '';

      return new Promise((resolve, reject) => {
        response.data.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const eventData: SSEEventData = JSON.parse(line.slice(6));

                // 处理不同类型的事件
                switch (eventData.type) {
                  case 'text.delta':
                    fullText += eventData.delta;
                    if (onTextDelta) {
                      onTextDelta(eventData.delta);
                    }
                    break;

                  case 'tool.start':
                    this.logger.log(`工具调用: ${eventData.name}`);
                    if (onToolCall) {
                      onToolCall(eventData.name, eventData.args);
                    }
                    break;

                  case 'tool.error':
                    this.logger.error(`工具错误: ${eventData.name} - ${eventData.message}`);
                    break;

                  case 'usage.final':
                    this.logger.log(
                      `Token 使用: prompt=${eventData.promptTokens}, completion=${eventData.completionTokens}`,
                    );
                    break;

                  case 'done':
                    this.logger.log(`流式生成完成，会话: ${conversationId}`);
                    // 添加助手回复到历史
                    if (fullText) {
                      const assistantMsg: SimpleMessage = {
                        role: 'assistant',
                        content: fullText,
                      };
                      this.conversationService.addMessage(conversationId, assistantMsg);
                    }
                    if (onComplete) {
                      onComplete(fullText);
                    }
                    resolve(fullText);
                    break;

                  case 'error':
                    this.logger.error(`流式错误: ${eventData.code} - ${eventData.message}`);
                    const error = new Error(eventData.message);
                    if (onError) {
                      onError(error);
                    }
                    reject(error);
                    break;
                }
              } catch (parseError) {
                this.logger.warn('解析 SSE 事件失败:', parseError);
              }
            }
          }
        });

        response.data.on('error', (error: any) => {
          this.logger.error('流式请求错误:', error);
          if (onError) {
            onError(error);
          }
          reject(error);
        });

        response.data.on('end', () => {
          if (fullText) {
            resolve(fullText);
          }
        });
      });
    } catch (error) {
      this.logger.error(`调用 /api/v1/chat (流式) 失败，会话: ${conversationId}`, error);
      if (onError) {
        onError(error);
      }
      throw error;
    }
  }

  /**
   * 生成简单的 AI 回复（兼容旧接口）
   * @param message 用户消息内容
   * @param context 上下文信息（包含 fromUser, roomId 等）
   */
  async generateReply(message: string, context?: any) {
    const conversationId = this.conversationService.generateConversationId(
      context?.fromUser || 'unknown',
      context?.roomId,
      context?.isRoom,
    );

    try {
      const response = await this.chat({
        conversationId,
        userMessage: message,
      });

      // 提取第一条助手消息的文本
      if (!response.messages || response.messages.length === 0) {
        throw new Error('API 响应中没有返回任何消息');
      }

      const assistantMessage = response.messages.find((m) => m.role === 'assistant');
      if (!assistantMessage) {
        throw new Error('API 响应中没有找到助手消息');
      }

      if (!assistantMessage.parts || assistantMessage.parts.length === 0) {
        throw new Error('助手消息中没有内容部分');
      }

      const textPart = assistantMessage.parts.find((p) => p.type === 'text');
      if (!textPart || !textPart.text) {
        throw new Error('助手消息中没有找到文本内容');
      }

      return {
        reply: textPart.text,
        usage: response.usage,
        tools: response.tools,
      };
    } catch (error) {
      this.logger.error('生成 AI 回复失败:', error);
      throw error;
    }
  }

  /**
   * 获取可用模型列表
   */
  async getModels() {
    try {
      this.logger.log('获取可用模型列表...');
      const response = await this.httpClient.get('/models');
      return response.data;
    } catch (error) {
      this.logger.error('获取模型列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取可用工具列表
   */
  async getTools() {
    try {
      this.logger.log('获取可用工具列表...');
      const response = await this.httpClient.get('/tools');
      return response.data;
    } catch (error) {
      this.logger.error('获取工具列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取可用的 promptType 列表
   */
  async getPromptTypes() {
    try {
      this.logger.log('获取可用的 promptType 列表...');
      const response = await this.httpClient.get('/prompt-types');
      return response.data;
    } catch (error) {
      this.logger.error('获取 promptType 列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取配置 Schema
   */
  async getConfigSchema() {
    try {
      this.logger.log('获取配置 Schema...');
      const response = await this.httpClient.get('/config-schema');
      return response.data;
    } catch (error) {
      this.logger.error('获取配置 Schema 失败:', error);
      throw error;
    }
  }

  /**
   * 清空会话历史
   */
  clearConversation(conversationId: string) {
    this.conversationService.clearConversation(conversationId);
    this.logger.log(`会话 ${conversationId} 已清空`);
  }

  /**
   * 获取会话统计信息
   */
  getConversationStats(conversationId: string) {
    return this.conversationService.getStats(conversationId);
  }

  /**
   * 健康检查
   */
  async healthCheck() {
    try {
      // 尝试获取模型列表来验证连接
      await this.getModels();
      return {
        status: 'healthy',
        baseURL: this.baseURL,
        message: 'Agent API 连接正常',
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        baseURL: this.baseURL,
        message: 'Agent API 连接失败',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
