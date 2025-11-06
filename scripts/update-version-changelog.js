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

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
  const tagList = tags.split('\n').filter(tag => tag.match(/^v?\d+\.\d+\.\d+$/));
  return tagList[0] || null;
}

/**
 * 获取从指定 tag 或指定数量的 commits
 */
function getCommits() {
  const lastTag = getLastTag();
  let command;

  if (lastTag) {
    command = `git log ${lastTag}..HEAD --format=%H||%s||%b||%an||%ae||%ad --date=short`;
  } else {
    command = `git log -${CONFIG.commitLimit} --format=%H||%s||%b||%an||%ae||%ad --date=short`;
  }

  const output = execGit(command);
  if (!output) return [];

  return output
    .split('\n')
    .filter(line => line.trim()) // 过滤空行
    .map(line => {
      const [hash, subject, body, author, email, date] = line.split('||');
      return { hash, subject, body, author, email, date };
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
    other: []
  };

  let hasBreaking = false;
  let hasFeat = false;
  let hasFix = false;

  commits.forEach(commit => {
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
 * 格式化 commit 为 markdown
 */
function formatCommitForChangelog(commit) {
  const shortHash = commit.hash.substring(0, 7);
  let message = commit.subject;

  // 移除类型前缀
  message = message.replace(/^(\w+)(\(.+\))?:\s*/, '');

  return `- ${message} ([${shortHash}](../../commit/${commit.hash}))`;
}

/**
 * 生成 CHANGELOG 内容
 */
function generateChangelog(version, types, commits) {
  const date = new Date().toISOString().split('T')[0];
  const branch = execGit('git rev-parse --abbrev-ref HEAD') || 'unknown';

  let changelog = `## [${version}] - ${date}\n\n`;
  changelog += `**分支**: \`${branch}\`\n\n`;

  if (types.breaking.length > 0) {
    changelog += `### 💥 BREAKING CHANGES\n\n`;
    types.breaking.forEach(commit => {
      changelog += formatCommitForChangelog(commit) + '\n';
    });
    changelog += '\n';
  }

  if (types.feat.length > 0) {
    changelog += `### ✨ 新功能\n\n`;
    types.feat.forEach(commit => {
      changelog += formatCommitForChangelog(commit) + '\n';
    });
    changelog += '\n';
  }

  if (types.fix.length > 0) {
    changelog += `### 🐛 Bug 修复\n\n`;
    types.fix.forEach(commit => {
      changelog += formatCommitForChangelog(commit) + '\n';
    });
    changelog += '\n';
  }

  if (types.perf.length > 0) {
    changelog += `### ⚡ 性能优化\n\n`;
    types.perf.forEach(commit => {
      changelog += formatCommitForChangelog(commit) + '\n';
    });
    changelog += '\n';
  }

  if (types.refactor.length > 0) {
    changelog += `### 🔧 重构\n\n`;
    types.refactor.forEach(commit => {
      changelog += formatCommitForChangelog(commit) + '\n';
    });
    changelog += '\n';
  }

  if (types.docs.length > 0) {
    changelog += `### 📝 文档\n\n`;
    types.docs.forEach(commit => {
      changelog += formatCommitForChangelog(commit) + '\n';
    });
    changelog += '\n';
  }

  if (types.test.length > 0) {
    changelog += `### ✅ 测试\n\n`;
    types.test.forEach(commit => {
      changelog += formatCommitForChangelog(commit) + '\n';
    });
    changelog += '\n';
  }

  if (types.chore.length > 0 || types.style.length > 0 || types.other.length > 0) {
    changelog += `### 🔨 其他更新\n\n`;
    [...types.chore, ...types.style, ...types.other].forEach(commit => {
      changelog += formatCommitForChangelog(commit) + '\n';
    });
    changelog += '\n';
  }

  return changelog;
}

/**
 * 更新 CHANGELOG.md
 */
function updateChangelog(version, types, commits) {
  const newEntry = generateChangelog(version, types, commits);

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
  updateChangelog(newVersion, types, commits);

  console.log('\n✨ 完成！');
}

// 运行
main();
