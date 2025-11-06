#!/usr/bin/env node

/**
 * 自动更新版本号和 CHANGELOG
 *
 * 功能：
 * 1. 分析最近的 commits
 * 2. 根据 Conventional Commits 判断版本更新类型
 * 3. 更新 package.json 版本号
 * 4. 生成/更新 CHANGELOG.md
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ES module 中获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 配置
const CONFIG = {
  packageJsonPath: path.join(__dirname, '../package.json'),
  changelogPath: path.join(__dirname, '../CHANGELOG.md'),
  commitLimit: 50, // 最多分析最近 50 个 commits
};

/**
 * 执行 git 命令
 */
function execGit(command) {
  try {
    return execSync(command, { encoding: 'utf-8' }).trim();
  } catch (error) {
    console.error(`Git 命令执行失败: ${command}`);
    console.error(error.message);
    return '';
  }
}

/**
 * 获取当前版本号
 */
function getCurrentVersion() {
  const packageJson = JSON.parse(fs.readFileSync(CONFIG.packageJsonPath, 'utf-8'));
  return packageJson.version;
}

/**
 * 获取最后一个版本 tag
 */
function getLastTag() {
  const tags = execGit('git tag --sort=-version:refname');
  if (!tags) return null;
  const tagList = tags.split('\n').filter((tag) => tag.match(/^v?\d+\.\d+\.\d+$/));
  return tagList[0] || null;
}

/**
 * 获取从指定 tag 或指定数量的 commits
 */
function getCommits() {
  const lastTag = getLastTag();
  let command;

  // 使用 %x1e (Record Separator) 分隔不同的提交
  // 使用 %x1f (Unit Separator) 分隔不同的字段
  // 这样可以正确处理多行提交消息
  const format = '%H%x1f%s%x1f%b%x1f%an%x1f%ae%x1f%ad%x1e';

  if (lastTag) {
    command = `git log ${lastTag}..HEAD --format="${format}" --date=short`;
  } else {
    command = `git log -${CONFIG.commitLimit} --format="${format}" --date=short`;
  }

  const output = execGit(command);
  if (!output) return [];

  return output
    .split('\x1e') // 使用 Record Separator 分隔提交
    .filter((record) => record.trim()) // 过滤空记录
    .map((record) => {
      const [hash, subject, body, author, email, date] = record.split('\x1f'); // 使用 Unit Separator 分隔字段
      return {
        hash: hash?.trim() || '',
        subject: subject?.trim() || '',
        body: body?.trim() || '',
        author: author?.trim() || '',
        email: email?.trim() || '',
        date: date?.trim() || '',
      };
    });
}

/**
 * 分析 commit 类型
 */
function analyzeCommits(commits) {
  const types = {
    breaking: [],
    feat: [],
    fix: [],
    perf: [],
    refactor: [],
    docs: [],
    style: [],
    test: [],
    chore: [],
    other: [],
  };

  let hasBreaking = false;
  let hasFeat = false;
  let hasFix = false;

  commits.forEach((commit) => {
    const { subject, body } = commit;

    // 跳过无效的 commit
    if (!subject) return;

    const fullMessage = `${subject}\n${body || ''}`;

    // 检查是否有 BREAKING CHANGE
    if (fullMessage.match(/BREAKING[- ]CHANGE:/i)) {
      types.breaking.push(commit);
      hasBreaking = true;
      return;
    }

    // 分析提交类型
    const match = subject.match(/^(\w+)(\(.+\))?:/);
    if (match) {
      const type = match[1].toLowerCase();
      if (types[type]) {
        types[type].push(commit);
        if (type === 'feat') hasFeat = true;
        if (type === 'fix') hasFix = true;
      } else {
        types.other.push(commit);
      }
    } else {
      types.other.push(commit);
    }
  });

  return { types, hasBreaking, hasFeat, hasFix };
}

/**
 * 计算新版本号
 */
function calculateNewVersion(currentVersion, hasBreaking, hasFeat, hasFix) {
  const [major, minor, patch] = currentVersion.split('.').map(Number);

  if (hasBreaking) {
    return `${major + 1}.0.0`;
  } else if (hasFeat) {
    return `${major}.${minor + 1}.0`;
  } else if (hasFix) {
    return `${major}.${minor}.${patch + 1}`;
  } else {
    // 即使没有明确的 fix，只要有更新就增加 patch
    return `${major}.${minor}.${patch + 1}`;
  }
}

/**
 * 更新 package.json 版本号
 */
function updatePackageVersion(newVersion) {
  const packageJson = JSON.parse(fs.readFileSync(CONFIG.packageJsonPath, 'utf-8'));
  packageJson.version = newVersion;
  fs.writeFileSync(CONFIG.packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
  console.log(`✅ 已更新 package.json 版本号: ${newVersion}`);
}

/**
 * 格式化 commit 为 changelog 条目
 */
function formatCommitForChangelog(commit) {
  const shortHash = commit.hash.substring(0, 7);
  let message = commit.subject;

  // 移除类型前缀，但保留作用域
  // feat(scope): message → scope: message
  // feat: message → message
  const match = message.match(/^(\w+)(?:\((.+?)\))?:\s*(.*)$/);
  if (match) {
    const [, , scope, description] = match;
    message = scope ? `${scope}: ${description}` : description;
  }

  return `${message} (${shortHash})`;
}

/**
 * 生成 CHANGELOG 内容
 */
function generateChangelog(version, types) {
  const date = new Date().toISOString().split('T')[0];
  const branch = execGit('git rev-parse --abbrev-ref HEAD') || 'unknown';

  let changelog = `## [${version}] - ${date}\n\n`;
  changelog += `**分支**: \`${branch}\`\n\n`;

  // 合并所有功能相关的提交到 Feature 更新
  const featureCommits = [
    ...types.breaking,
    ...types.feat,
    ...types.perf,
    ...types.refactor,
    ...types.docs,
    ...types.test,
    ...types.chore,
    ...types.style,
    ...types.other,
  ];

  // Bug 修复
  if (types.fix.length > 0) {
    changelog += `Bug 修复：\n`;
    types.fix.forEach((commit) => {
      changelog += `- ${formatCommitForChangelog(commit)}\n`;
    });
    changelog += '\n';
  }

  // Feature 更新（包含所有非 bug 修复的提交）
  if (featureCommits.length > 0) {
    changelog += `Feature 更新：\n`;
    featureCommits.forEach((commit) => {
      changelog += `- ${formatCommitForChangelog(commit)}\n`;
    });
    changelog += '\n';
  }

  return changelog;
}

/**
 * 更新 CHANGELOG.md
 */
function updateChangelog(version, types) {
  const newEntry = generateChangelog(version, types);

  let existingChangelog = '';
  if (fs.existsSync(CONFIG.changelogPath)) {
    existingChangelog = fs.readFileSync(CONFIG.changelogPath, 'utf-8');
  } else {
    existingChangelog = '# Changelog\n\n所有重要的项目更改都将记录在此文件中。\n\n';
  }

  // 在第一个版本记录之前插入新内容
  const versionRegex = /^## \[/m;
  const match = existingChangelog.match(versionRegex);

  let updatedChangelog;
  if (match) {
    const insertPosition = match.index;
    updatedChangelog =
      existingChangelog.substring(0, insertPosition) +
      newEntry +
      '\n' +
      existingChangelog.substring(insertPosition);
  } else {
    updatedChangelog = existingChangelog + '\n' + newEntry;
  }

  fs.writeFileSync(CONFIG.changelogPath, updatedChangelog);
  console.log(`✅ 已更新 CHANGELOG.md`);
}

/**
 * 主函数
 */
function main() {
  console.log('🚀 开始更新版本号和 CHANGELOG...\n');

  // 1. 获取当前版本
  const currentVersion = getCurrentVersion();
  console.log(`📦 当前版本: ${currentVersion}`);

  // 2. 获取 commits
  const commits = getCommits();
  if (commits.length === 0) {
    console.log('ℹ️  没有发现新的提交，跳过更新');
    return;
  }
  console.log(`📝 发现 ${commits.length} 个新提交`);

  // 3. 分析 commits
  const { types, hasBreaking, hasFeat, hasFix } = analyzeCommits(commits);

  // 4. 计算新版本号
  const newVersion = calculateNewVersion(currentVersion, hasBreaking, hasFeat, hasFix);
  console.log(`📦 新版本: ${newVersion}`);

  // 5. 更新 package.json
  updatePackageVersion(newVersion);

  // 6. 更新 CHANGELOG.md
  updateChangelog(newVersion, types);

  console.log('\n✨ 完成！');
}

// 运行
main();
