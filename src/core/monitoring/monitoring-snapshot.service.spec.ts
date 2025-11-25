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
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('true'),
  };

  const mockSnapshot: MonitoringSnapshot = {
    version: 1,
    savedAt: Date.now(),
    detailRecords: [],
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
    it('should read snapshot from Redis', async () => {
      mockRedisService.get.mockResolvedValue(mockSnapshot);

      const result = await service.readSnapshot();

      expect(result).toEqual(mockSnapshot);
      expect(mockRedisService.get).toHaveBeenCalledWith('monitoring:snapshot');
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
    it('should save snapshot to Redis with TTL', async () => {
      mockRedisService.setex.mockResolvedValue(undefined);

      service.saveSnapshot(mockSnapshot);

      // Wait for async queue to process
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'monitoring:snapshot',
        3600, // TTL 1 hour
        mockSnapshot,
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
