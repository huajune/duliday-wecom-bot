import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bull';
import { RedisService } from '@core/redis';
import { SupabaseService, AgentReplyConfig } from '@core/supabase';
import { MessageMergeService } from './message-merge.service';
import {
  MAX_RETRY_COUNT,
  MIN_MESSAGE_LENGTH_TO_RETRY,
  COLLECT_MESSAGES_DURING_PROCESSING,
  OVERFLOW_STRATEGY,
} from '@core/config/constants/message.constants';
import { ConversationStatus } from '../interfaces/message-merge.interface';

describe('MessageMergeService', () => {
  let service: MessageMergeService;
  // let supabaseService: SupabaseService;
  // let redisService: RedisService;
  // let messageQueue: any;

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockRedisService = {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    scan: jest.fn(),
  };

  const mockSupabaseService = {
    getAgentReplyConfig: jest.fn(),
    onAgentReplyConfigChange: jest.fn(),
  };

  const mockMessageQueue = {
    add: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageMergeService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: SupabaseService,
          useValue: mockSupabaseService,
        },
        {
          provide: getQueueToken('message-merge'),
          useValue: mockMessageQueue,
        },
      ],
    }).compile();

    service = module.get<MessageMergeService>(MessageMergeService);
    // supabaseService = module.get<SupabaseService>(SupabaseService);
    // redisService = module.get<RedisService>(RedisService);
    // messageQueue = module.get(getQueueToken('message-merge'));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('initialization', () => {
    it('should initialize with default constants', () => {
      const stats = service.getStats();
      expect(stats.config.maxRetryCount).toBe(MAX_RETRY_COUNT);
      expect(stats.config.minMessageLength).toBe(MIN_MESSAGE_LENGTH_TO_RETRY);
      expect(stats.config.collectDuringProcessing).toBe(COLLECT_MESSAGES_DURING_PROCESSING);
      expect(stats.config.overflowStrategy).toBe(OVERFLOW_STRATEGY);
      // Default dynamic values
      expect(stats.config.initialMergeWindow).toBe(3000);
      expect(stats.config.maxMergedMessages).toBe(3);
    });

    it('should load config from Supabase on module init', async () => {
      const mockConfig: Partial<AgentReplyConfig> = {
        initialMergeWindowMs: 5000,
        maxMergedMessages: 5,
      };
      mockSupabaseService.getAgentReplyConfig.mockResolvedValue(mockConfig);

      await service.onModuleInit();

      const stats = service.getStats();
      expect(stats.config.initialMergeWindow).toBe(5000);
      expect(stats.config.maxMergedMessages).toBe(5);
    });
  });

  describe('handleMessage', () => {
    const mockMessage = {
      chatId: 'test-chat',
      messageId: 'msg-1',
      msgType: 'text',
      content: 'hello',
      createTime: Date.now(),
    };

    it('should start new conversation in IDLE state', async () => {
      mockRedisService.get.mockResolvedValue(null); // No existing state

      await service.handleMessage(mockMessage as any);

      expect(mockRedisService.setex).toHaveBeenCalledWith(
        expect.stringContaining('test-chat'),
        expect.any(Number),
        expect.objectContaining({
          status: ConversationStatus.WAITING,
          pendingMessages: expect.arrayContaining([
            expect.objectContaining({ messageData: mockMessage }),
          ]),
        }),
      );
    });

    it('should add to queue in WAITING state', async () => {
      const existingState = {
        chatId: 'test-chat',
        status: ConversationStatus.WAITING,
        firstMessageTime: Date.now(),
        pendingMessages: [{ messageData: { ...mockMessage, messageId: 'msg-0' } }],
        lastUpdateTime: Date.now(),
      };
      mockRedisService.get.mockResolvedValue(existingState);

      // Simulate timer existing in memory
      service['timers'].set(
        'test-chat',
        setTimeout(() => {}, 1000),
      );

      await service.handleMessage(mockMessage as any);

      expect(mockRedisService.setex).toHaveBeenCalledWith(
        expect.stringContaining('test-chat'),
        expect.any(Number),
        expect.objectContaining({
          pendingMessages: expect.arrayContaining([
            expect.anything(), // msg-0
            expect.objectContaining({ messageData: mockMessage }), // msg-1
          ]),
        }),
      );
    });

    it('should trigger immediate processing if max messages reached', async () => {
      const existingState = {
        chatId: 'test-chat',
        status: ConversationStatus.WAITING,
        firstMessageTime: Date.now(),
        // Already has 2 messages, max is 3
        pendingMessages: [
          { messageData: { ...mockMessage, messageId: 'msg-1' } },
          { messageData: { ...mockMessage, messageId: 'msg-2' } },
        ],
        lastUpdateTime: Date.now(),
      };
      mockRedisService.get.mockResolvedValue(existingState);

      service['timers'].set(
        'test-chat',
        setTimeout(() => {}, 1000),
      );

      await service.handleMessage(mockMessage as any);

      // Should have cleared timer
      expect(service['timers'].has('test-chat')).toBe(false);

      // Should have added to queue (via setImmediate, so we wait a tick)
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockMessageQueue.add).toHaveBeenCalled();
    });
  });
});
