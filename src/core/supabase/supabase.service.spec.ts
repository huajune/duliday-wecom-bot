import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from './supabase.service';
import { HttpClientFactory } from '@core/client-http';
import { RedisService } from '@core/redis';

describe('SupabaseService', () => {
  let service: SupabaseService;

  const mockHttpClient = {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  };

  const mockHttpClientFactory = {
    createWithBearerAuth: jest.fn().mockReturnValue(mockHttpClient),
  };

  const mockRedisService = {
    get: jest.fn(),
    setex: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const config: Record<string, string> = {
        NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
        ENABLE_AI_REPLY: 'true',
      };
      return config[key] ?? defaultValue;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupabaseService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: HttpClientFactory,
          useValue: mockHttpClientFactory,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    service = module.get<SupabaseService>(SupabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('isAvailable', () => {
    it('should return true when initialized', () => {
      expect(service.isAvailable()).toBe(true);
    });
  });

  describe('upsertMonitoringHourly', () => {
    const mockHourlyData = {
      hour: '2025-11-25T10:00:00.000Z',
      message_count: 100,
      success_count: 95,
      failure_count: 5,
      avg_duration: 5000.5,
      p95_duration: 8000.0,
      active_users: 10,
      active_chats: 5,
      total_tokens: 50000,
    };

    it('should upsert monitoring hourly data', async () => {
      mockHttpClient.post.mockResolvedValue({ data: mockHourlyData });

      await service.upsertMonitoringHourly(mockHourlyData);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        '/monitoring_hourly',
        mockHourlyData,
        expect.objectContaining({
          headers: {
            Prefer: 'resolution=merge-duplicates',
          },
        }),
      );
    });

    it('should throw error on upsert failure', async () => {
      mockHttpClient.post.mockRejectedValue(new Error('Database error'));

      await expect(service.upsertMonitoringHourly(mockHourlyData)).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('deleteMonitoringHourlyBefore', () => {
    it('should delete old records and return count', async () => {
      const deletedRecords = [{ id: 1 }, { id: 2 }, { id: 3 }];
      mockHttpClient.delete.mockResolvedValue({ data: deletedRecords });

      const cutoffDate = new Date('2025-10-01T00:00:00.000Z');
      const result = await service.deleteMonitoringHourlyBefore(cutoffDate);

      expect(result).toBe(3);
      expect(mockHttpClient.delete).toHaveBeenCalledWith(
        '/monitoring_hourly',
        expect.objectContaining({
          params: {
            hour: `lt.${cutoffDate.toISOString()}`,
          },
        }),
      );
    });

    it('should return 0 on delete error', async () => {
      mockHttpClient.delete.mockRejectedValue(new Error('Delete failed'));

      const result = await service.deleteMonitoringHourlyBefore(new Date());

      expect(result).toBe(0);
    });
  });

  describe('getMonitoringHourlyHistory', () => {
    it('should fetch historical data', async () => {
      const mockHistory = [
        {
          hour: '2025-11-25T10:00:00.000Z',
          message_count: 100,
          success_count: 95,
          failure_count: 5,
          avg_duration: 5000,
          p95_duration: 8000,
          active_users: 10,
          active_chats: 5,
          total_tokens: 50000,
        },
        {
          hour: '2025-11-25T09:00:00.000Z',
          message_count: 80,
          success_count: 75,
          failure_count: 5,
          avg_duration: 4500,
          p95_duration: 7500,
          active_users: 8,
          active_chats: 4,
          total_tokens: 40000,
        },
      ];

      mockHttpClient.get.mockResolvedValue({ data: mockHistory });

      const result = await service.getMonitoringHourlyHistory(7);

      expect(result).toEqual(mockHistory);
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        '/monitoring_hourly',
        expect.objectContaining({
          params: expect.objectContaining({
            order: 'hour.desc',
            select: '*',
          }),
        }),
      );
    });

    it('should return empty array on fetch error', async () => {
      mockHttpClient.get.mockRejectedValue(new Error('Fetch failed'));

      const result = await service.getMonitoringHourlyHistory(7);

      expect(result).toEqual([]);
    });

    it('should use correct cutoff date for days parameter', async () => {
      mockHttpClient.get.mockResolvedValue({ data: [] });

      await service.getMonitoringHourlyHistory(30);

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        '/monitoring_hourly',
        expect.objectContaining({
          params: expect.objectContaining({
            hour: expect.stringMatching(/^gte\.\d{4}-\d{2}-\d{2}T/),
          }),
        }),
      );
    });
  });
});
