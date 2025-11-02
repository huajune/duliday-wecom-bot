import { Test, TestingModule } from '@nestjs/testing';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentConfigService } from './agent-config.service';
import { AgentRegistryService } from './agent-registry.service';
import { AgentCacheService } from './agent-cache.service';
import { ConfigService } from '@nestjs/config';

describe('AgentController', () => {
  let controller: AgentController;
  let service: AgentService;
  let registryService: AgentRegistryService;

  const mockAgentService = {
    getTools: jest.fn(),
    getModels: jest.fn(),
    chat: jest.fn(),
  };

  const mockRegistryService = {
    getHealthStatus: jest.fn(),
    getConfiguredTools: jest.fn(),
    getAvailableModels: jest.fn(),
    refresh: jest.fn(),
  };

  const mockAgentConfigService = {
    getAllProfiles: jest.fn(),
    getProfile: jest.fn(),
    validateProfile: jest.fn(),
  };

  const mockCacheService = {
    getStats: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentController],
      providers: [
        {
          provide: AgentService,
          useValue: mockAgentService,
        },
        {
          provide: AgentRegistryService,
          useValue: mockRegistryService,
        },
        {
          provide: AgentConfigService,
          useValue: mockAgentConfigService,
        },
        {
          provide: AgentCacheService,
          useValue: mockCacheService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    controller = module.get<AgentController>(AgentController);
    service = module.get<AgentService>(AgentService);
    registryService = module.get<AgentRegistryService>(AgentRegistryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('healthCheck', () => {
    it('should return healthy status when all configured resources are available', async () => {
      const mockHealthStatus = {
        models: { configuredAvailable: true },
        tools: { allAvailable: true },
        lastRefreshTime: new Date().toISOString(),
      };

      mockRegistryService.getHealthStatus.mockReturnValue(mockHealthStatus);

      const result = await controller.healthCheck();

      expect(registryService.getHealthStatus).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data.status).toEqual('healthy');
    });

    it('should return degraded status when some resources are unavailable', async () => {
      const mockHealthStatus = {
        models: { configuredAvailable: true },
        tools: { allAvailable: false },
        lastRefreshTime: new Date().toISOString(),
      };

      mockRegistryService.getHealthStatus.mockReturnValue(mockHealthStatus);

      const result = await controller.healthCheck();

      expect(registryService.getHealthStatus).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data.status).toEqual('degraded');
    });
  });

  describe('getTools', () => {
    it('should call agentService.getTools', async () => {
      const mockResult = {
        tools: ['tool1', 'tool2', 'tool3'],
        count: 3,
      };

      mockAgentService.getTools.mockResolvedValue(mockResult);

      const result = await controller.getTools();

      expect(service.getTools).toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });

    it('should handle empty tools list', async () => {
      const mockResult = { tools: [], count: 0 };

      mockAgentService.getTools.mockResolvedValue(mockResult);

      const result = await controller.getTools();

      expect(service.getTools).toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });

    it('should handle errors from agentService.getTools', async () => {
      const error = new Error('Get tools failed');

      mockAgentService.getTools.mockRejectedValue(error);

      await expect(controller.getTools()).rejects.toThrow('Get tools failed');
    });
  });

  describe('getModels', () => {
    it('should call agentService.getModels', async () => {
      const mockResult = {
        models: ['gpt-3.5-turbo', 'gpt-4', 'claude-3'],
        count: 3,
      };

      mockAgentService.getModels.mockResolvedValue(mockResult);

      const result = await controller.getModels();

      expect(service.getModels).toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });

    it('should handle errors from agentService.getModels', async () => {
      const error = new Error('Get models failed');

      mockAgentService.getModels.mockRejectedValue(error);

      await expect(controller.getModels()).rejects.toThrow('Get models failed');
    });
  });

  describe('testChat', () => {
    it('should call agentService.chat with all parameters', async () => {
      const mockBody = {
        message: '你好',
        conversationId: 'conv123',
        model: 'gpt-4',
      };
      const mockResult = { reply: '你好！', conversationId: 'conv123' };

      mockAgentService.chat.mockResolvedValue(mockResult);

      const result = await controller.testChat(mockBody);

      expect(service.chat).toHaveBeenCalledWith({
        conversationId: 'conv123',
        userMessage: '你好',
        model: 'gpt-4',
      });
      expect(result).toEqual(mockResult);
    });

    it('should use default conversationId when not provided', async () => {
      const mockBody = { message: '测试消息' };
      const mockResult = { reply: '收到测试消息', conversationId: 'test-user' };

      mockAgentService.chat.mockResolvedValue(mockResult);

      const result = await controller.testChat(mockBody);

      expect(service.chat).toHaveBeenCalledWith({
        conversationId: 'test-user',
        userMessage: '测试消息',
        model: undefined,
      });
      expect(result).toEqual(mockResult);
    });

    it('should call agentService.chat without model parameter', async () => {
      const mockBody = {
        message: '你好',
        conversationId: 'conv456',
      };
      const mockResult = { reply: '你好！', conversationId: 'conv456' };

      mockAgentService.chat.mockResolvedValue(mockResult);

      const result = await controller.testChat(mockBody);

      expect(service.chat).toHaveBeenCalledWith({
        conversationId: 'conv456',
        userMessage: '你好',
        model: undefined,
      });
      expect(result).toEqual(mockResult);
    });

    it('should handle errors from agentService.chat', async () => {
      const mockBody = { message: '测试' };
      const error = new Error('Chat failed');

      mockAgentService.chat.mockRejectedValue(error);

      await expect(controller.testChat(mockBody)).rejects.toThrow('Chat failed');
    });
  });
});
