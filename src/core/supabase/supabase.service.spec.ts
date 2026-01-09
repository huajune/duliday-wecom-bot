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

  describe('initialization', () => {
    it('should initialize HTTP client when credentials are provided', () => {
      expect(mockHttpClientFactory.createWithBearerAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://test.supabase.co/rest/v1',
          timeout: 120000,
        }),
        'test-service-key',
      );
    });

    it('should be available when initialized', () => {
      expect(service.isAvailable()).toBe(true);
      expect(service.isClientInitialized()).toBe(true);
    });
  });

  describe('getHttpClient', () => {
    it('should return HTTP client when initialized', () => {
      const client = service.getHttpClient();
      expect(client).toBeDefined();
      expect(client).toBe(mockHttpClient);
    });
  });

  describe('getRedisService', () => {
    it('should return Redis service', () => {
      const redis = service.getRedisService();
      expect(redis).toBe(mockRedisService);
    });
  });

  describe('getCachePrefix', () => {
    it('should return cache prefix', () => {
      const prefix = service.getCachePrefix();
      expect(prefix).toBe('supabase:');
    });
  });

  describe('getConfigService', () => {
    it('should return config service', () => {
      const config = service.getConfigService();
      expect(config).toBe(mockConfigService);
    });
  });

  describe('when credentials are missing', () => {
    let uninitializedService: SupabaseService;

    beforeEach(async () => {
      const emptyConfigService = {
        get: jest.fn().mockReturnValue(''),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SupabaseService,
          {
            provide: ConfigService,
            useValue: emptyConfigService,
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

      uninitializedService = module.get<SupabaseService>(SupabaseService);
    });

    it('should not be available', () => {
      expect(uninitializedService.isAvailable()).toBe(false);
      expect(uninitializedService.isClientInitialized()).toBe(false);
    });

    it('should return null for HTTP client', () => {
      expect(uninitializedService.getHttpClient()).toBeNull();
    });
  });
});
