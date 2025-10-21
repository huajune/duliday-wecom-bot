#!/usr/bin/env node

/**
 * 环境配置检查脚本
 * 用于验证环境变量配置是否完整且正确
 */

const fs = require('fs');
const path = require('path');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// 必填配置项
const REQUIRED_CONFIGS = {
  development: ['AGENT_API_KEY', 'AGENT_API_BASE_URL', 'STRIDE_API_BASE_URL'],
  production: ['AGENT_API_KEY', 'AGENT_API_BASE_URL', 'STRIDE_API_BASE_URL'],
  test: [],
};

// 推荐配置项
const RECOMMENDED_CONFIGS = [
  'AGENT_DEFAULT_MODEL',
  'AGENT_API_TIMEOUT',
  'ENABLE_AI_REPLY',
  'PORT',
  'NODE_ENV',
  'CONVERSATION_MAX_MESSAGES',
  'CONVERSATION_TIMEOUT_MS',
  'HTTP_CLIENT_TIMEOUT',
];

// 读取 .env 文件
function readEnvFile(filename) {
  const filePath = path.join(__dirname, '..', filename);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const config = {};

  content.split('\n').forEach(line => {
    line = line.trim();
    
    // 跳过注释和空行
    if (!line || line.startsWith('#')) {
      return;
    }

    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      config[key] = value;
    }
  });

  return config;
}

// 检查单个环境配置
function checkEnvConfig(envName, filename) {
  log(`\n📋 检查 ${envName} 环境配置: ${filename}`, 'cyan');
  log('─'.repeat(60), 'cyan');

  const config = readEnvFile(filename);

  if (!config) {
    log(`❌ 配置文件不存在: ${filename}`, 'red');
    return false;
  }

  let hasError = false;
  let hasWarning = false;

  // 检查必填配置
  const requiredConfigs = REQUIRED_CONFIGS[envName] || [];
  if (requiredConfigs.length > 0) {
    log('\n必填配置项:', 'blue');
    requiredConfigs.forEach(key => {
      if (!config[key] || config[key] === '' || config[key] === 'your-api-key-here') {
        log(`  ❌ ${key}: 缺失或未配置`, 'red');
        hasError = true;
      } else {
        const displayValue = key.includes('KEY') || key.includes('TOKEN') 
          ? '***已配置***' 
          : config[key];
        log(`  ✅ ${key}: ${displayValue}`, 'green');
      }
    });
  }

  // 检查推荐配置
  log('\n推荐配置项:', 'blue');
  RECOMMENDED_CONFIGS.forEach(key => {
    if (!config[key] || config[key] === '') {
      log(`  ⚠️  ${key}: 未配置（将使用默认值）`, 'yellow');
      hasWarning = true;
    } else {
      log(`  ✅ ${key}: ${config[key]}`, 'green');
    }
  });

  // 总结
  log('\n' + '─'.repeat(60), 'cyan');
  if (hasError) {
    log(`❌ ${envName} 环境配置检查失败：存在必填项未配置`, 'red');
    return false;
  } else if (hasWarning) {
    log(`⚠️  ${envName} 环境配置检查通过：部分推荐配置项未配置`, 'yellow');
    return true;
  } else {
    log(`✅ ${envName} 环境配置检查通过：所有配置项已完整配置`, 'green');
    return true;
  }
}

// 主函数
function main() {
  log('\n' + '='.repeat(60), 'cyan');
  log('  🔍 环境配置检查工具', 'cyan');
  log('='.repeat(60), 'cyan');

  const environments = [
    { name: 'development', file: '.env.development' },
    { name: 'production', file: '.env.production' },
    { name: 'test', file: '.env.test' },
  ];

  let allPassed = true;

  environments.forEach(({ name, file }) => {
    const passed = checkEnvConfig(name, file);
    if (!passed) {
      allPassed = false;
    }
  });

  // 检查是否存在 .env 文件
  log('\n📋 检查本地开发配置: .env', 'cyan');
  log('─'.repeat(60), 'cyan');
  const localConfig = readEnvFile('.env');
  if (!localConfig) {
    log('⚠️  .env 文件不存在，首次使用请执行: cp .env.example .env', 'yellow');
  } else {
    log('✅ .env 文件存在', 'green');
  }

  // 最终总结
  log('\n' + '='.repeat(60), 'cyan');
  if (allPassed) {
    log('✅ 所有环境配置检查完成！', 'green');
    log('\n💡 提示：', 'blue');
    log('  - 开发环境: npm run start:dev', 'blue');
    log('  - 生产环境: npm run start:prod', 'blue');
    log('  - 测试环境: npm run test', 'blue');
  } else {
    log('❌ 部分环境配置存在问题，请检查并修复', 'red');
    log('\n📖 详细配置说明请查看: docs/ENV_CONFIG.md', 'yellow');
    process.exit(1);
  }
  log('='.repeat(60), 'cyan');
  log('');
}

// 运行检查
main();

