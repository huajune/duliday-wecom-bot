import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MonitoringSnapshotService } from './monitoring-snapshot.service';
import { RedisService } from '@core/redis';
import { MonitoringSnapshot } from './interfaces/monitoring.interface';

describe('MonitoringSnapshotService', () => {
  let service: MonitoringSnapshotService;
  let _redisService: RedisService;

  const mockRedisService = {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('true'),
  };

  const mockSnapshot: MonitoringSnapshot = {
    version: 1,
    savedAt: Date.now(),
    detailRecords: [
      {
        messageId: 'msg1',
        chatId: 'chat1',
        userId: 'user1',
        receivedAt: Date.now(),
        status: 'success',
      },
      {
        messageId: 'msg2',
        chatId: 'chat2',
        userId: 'user2',
        receivedAt: Date.now(),
        status: 'success',
      },
    ],
    hourlyStats: [],
    errorLogs: [],
    globalCounters: {
      totalMessages: 100,
      totalSuccess: 95,
      totalFailure: 5,
      totalAiDuration: 50000,
      totalSendDuration: 10000,
      totalFallback: 2,
      totalFallbackSuccess: 1,
    },
    activeUsers: ['user1', 'user2'],
    activeChats: ['chat1', 'chat2'],
    currentProcessing: 0,
    peakProcessing: 5,
  };

  // 新格式的 meta 数据
  const mockMeta = {
    version: 1,
    savedAt: mockSnapshot.savedAt,
    globalCounters: mockSnapshot.globalCounters,
    activeUsersCount: 2,
    activeChatsCount: 2,
    currentProcessing: 0,
    peakProcessing: 5,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonitoringSnapshotService,
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<MonitoringSnapshotService>(MonitoringSnapshotService);
    _redisService = module.get<RedisService>(RedisService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('readSnapshot', () => {
    it('should read snapshot from new separated Redis keys', async () => {
      // 模拟新格式的分离存储
      mockRedisService.get
        .mockResolvedValueOnce(mockMeta) // monitoring:meta
        .mockResolvedValueOnce(mockSnapshot.hourlyStats) // monitoring:hourly-stats
        .mockResolvedValueOnce(mockSnapshot.errorLogs) // monitoring:error-logs
        .mockResolvedValueOnce(mockSnapshot.detailRecords); // monitoring:records

      const result = await service.readSnapshot();

      expect(result).not.toBeNull();
      expect(result?.version).toBe(1);
      expect(result?.globalCounters).toEqual(mockSnapshot.globalCounters);
      // activeUsers/activeChats 从 detailRecords 重建
      expect(result?.activeUsers).toEqual(['user1', 'user2']);
      expect(result?.activeChats).toEqual(['chat1', 'chat2']);
      expect(mockRedisService.get).toHaveBeenCalledWith('monitoring:meta');
    });

    it('should fallback to legacy format when new format not found', async () => {
      mockRedisService.get
        .mockResolvedValueOnce(null) // monitoring:meta 不存在
        .mockResolvedValueOnce(mockSnapshot); // 旧格式 monitoring:snapshot

      mockRedisService.del.mockResolvedValue(undefined);

      const result = await service.readSnapshot();

      expect(result).toEqual(mockSnapshot);
      // 应该删除旧格式数据
      expect(mockRedisService.del).toHaveBeenCalledWith('monitoring:snapshot');
    });

    it('should return null when no snapshot exists', async () => {
      mockRedisService.get.mockResolvedValue(null);

      const result = await service.readSnapshot();

      expect(result).toBeNull();
    });

    it('should return null and log warning on Redis error', async () => {
      mockRedisService.get.mockRejectedValue(new Error('Redis connection failed'));

      const result = await service.readSnapshot();

      expect(result).toBeNull();
    });
  });

  describe('saveSnapshot', () => {
    it('should save snapshot to separated Redis keys', async () => {
      mockRedisService.setex.mockResolvedValue(undefined);

      service.saveSnapshot(mockSnapshot);

      // Wait for async queue to process
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 应该调用 4 次 setex（meta, hourly-stats, error-logs, records）
      expect(mockRedisService.setex).toHaveBeenCalledTimes(4);

      // 验证 meta 写入（TTL = 120 天 = 86400 * 120 = 10368000 秒）
      const TTL_120_DAYS = 86400 * 120;
      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'monitoring:meta',
        TTL_120_DAYS,
        expect.objectContaining({
          version: 1,
          activeUsersCount: 2,
          activeChatsCount: 2,
        }),
      );

      // 验证 records 写入
      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'monitoring:records',
        TTL_120_DAYS,
        mockSnapshot.detailRecords,
      );
    });

    it('should handle Redis write errors gracefully', async () => {
      mockRedisService.setex.mockRejectedValue(new Error('Redis write failed'));

      // Should not throw
      service.saveSnapshot(mockSnapshot);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockRedisService.setex).toHaveBeenCalled();
    });
  });

  describe('clearAll', () => {
    it('should delete all monitoring Redis keys', async () => {
      mockRedisService.del.mockResolvedValue(undefined);

      await service.clearAll();

      expect(mockRedisService.del).toHaveBeenCalledWith('monitoring:meta');
      expect(mockRedisService.del).toHaveBeenCalledWith('monitoring:hourly-stats');
      expect(mockRedisService.del).toHaveBeenCalledWith('monitoring:error-logs');
      expect(mockRedisService.del).toHaveBeenCalledWith('monitoring:records');
      expect(mockRedisService.del).toHaveBeenCalledWith('monitoring:snapshot');
    });
  });

  describe('clearRecords', () => {
    it('should only delete records key', async () => {
      mockRedisService.del.mockResolvedValue(undefined);

      await service.clearRecords();

      expect(mockRedisService.del).toHaveBeenCalledWith('monitoring:records');
      expect(mockRedisService.del).toHaveBeenCalledTimes(1);
    });
  });

  describe('when disabled', () => {
    beforeEach(async () => {
      mockConfigService.get.mockReturnValue('false');

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MonitoringSnapshotService,
          {
            provide: RedisService,
            useValue: mockRedisService,
          },
          {
            provide: ConfigService,
            useValue: mockConfigService,
          },
        ],
      }).compile();

      service = module.get<MonitoringSnapshotService>(MonitoringSnapshotService);
    });

    it('should return null on readSnapshot when disabled', async () => {
      const result = await service.readSnapshot();

      expect(result).toBeNull();
      expect(mockRedisService.get).not.toHaveBeenCalled();
    });

    it('should not write on saveSnapshot when disabled', async () => {
      service.saveSnapshot(mockSnapshot);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockRedisService.setex).not.toHaveBeenCalled();
    });
  });
});
