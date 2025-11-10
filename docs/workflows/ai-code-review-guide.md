# AI Code Review Setup Guide

This repository uses AI-powered code reviews with Claude 3.5 Sonnet to automatically review pull requests.

## 🚀 Quick Setup

### 1. Get Anthropic API Key

1. Visit [Anthropic Console](https://console.anthropic.com/)
2. Sign up or log in
3. Navigate to **API Keys** section
4. Create a new API key
5. Copy the key (starts with `sk-ant-...`)

### 2. Add API Key to GitHub Secrets

1. Go to your repository on GitHub
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `ANTHROPIC_API_KEY`
5. Value: Paste your API key
6. Click **Add secret**

### 3. Verify Workflow

1. Create a test branch: `git checkout -b test/ai-review`
2. Make a small change to a TypeScript file
3. Commit and push: `git push origin test/ai-review`
4. Create a pull request to `develop` branch
5. Check the **Actions** tab to see the workflow running
6. The AI review will appear as a comment on your PR

## 📋 What Gets Reviewed

The AI code review agent analyzes:

✅ **Critical Issues**
- Bugs and logic errors
- Security vulnerabilities (hardcoded secrets, SQL injection, XSS)
- Performance problems

✅ **Code Quality**
- TypeScript best practices
- NestJS patterns compliance
- Proper use of dependency injection
- Error handling

✅ **Architecture Compliance**
- DDD layer violations
- Service responsibility boundaries
- Module organization

✅ **Project Standards**
- No use of `any` type
- No `console.log` (must use `Logger`)
- No hardcoded values (must use env variables)
- Proper naming conventions

## 🎯 Review Triggers

The AI review runs automatically on:
- New pull requests to `develop`, `main`, or `master`
- New commits pushed to existing PRs
- PR re-opened

Only reviews files with extensions: `.ts`, `.js`, `.tsx`, `.jsx`

## 📊 Review Format

The AI review comment includes:

```markdown
## 🤖 AI Code Review

**Changes Summary:**
- 📝 Files changed: X
- ➕ Lines added: Y
- ➖ Lines removed: Z

---

### Critical Issues
[Security, bugs, performance problems]

### Code Quality
[TypeScript, NestJS best practices]

### Architecture Concerns
[DDD violations, wrong layer usage]

### Suggestions
[Improvements, optimizations]

---
Powered by Claude 3.5 Sonnet
```

## 🔧 Customization

### Adjust Review Scope

Edit `.github/workflows/ai-code-review.yml`:

```yaml
# Change file patterns to review
CHANGED_FILES=$(git diff --name-only ... | grep -E '\.(ts|js|tsx|jsx|py|go)$')

# Adjust diff size limit (default: 50000 chars)
DIFF_OUTPUT=$(git diff ... | head -c 100000)
```

### Change AI Model

Edit the workflow file:

```yaml
"model": "claude-sonnet-4-20250514"    # Current: Claude Sonnet 4.5 (最新最强)
# or
"model": "claude-3-5-sonnet-20241022"  # Claude 3.5 Sonnet (更经济)
# or
"model": "claude-3-opus-20240229"      # Claude 3 Opus (平衡性能)
```

### Add Custom Review Rules

The AI automatically reads `.cursorrules` file for project-specific coding standards. Update that file to customize review criteria.

## 💡 Best Practices

### For Developers

1. **Before Creating PR:**
   - Run `pnpm run lint` and `pnpm run format`
   - Fix obvious issues first
   - Add meaningful commit messages

2. **Responding to AI Review:**
   - Address critical issues first
   - Consider suggestions seriously
   - Reply to the review comment with your actions

3. **For Large PRs:**
   - Split into smaller, focused PRs
   - AI review is most effective on <500 lines

### For Reviewers

- Use AI review as a **first pass**, not replacement for human review
- Focus on business logic and requirements (AI focuses on code quality)
- AI may miss context-specific issues

## 🐛 Troubleshooting

### Workflow Fails

1. **Check API Key:**
   - Verify secret name is exactly `ANTHROPIC_API_KEY`
   - Ensure key is valid and has credits

2. **Check Permissions:**
   - Workflow needs `contents: read` and `pull-requests: write`
   - Verify in repository Settings → Actions → General

3. **View Logs:**
   - Go to Actions tab → Select failed workflow
   - Check step-by-step logs

### No Review Comment Posted

- Check if PR has TypeScript/JavaScript file changes
- Verify API key has sufficient credits
- Check Actions logs for errors

### Review Quality Issues

- Ensure `.cursorrules` file is up to date
- Consider adjusting the review prompt in workflow file
- Try different Claude models

## 📈 Monitoring

Track AI review usage:

1. **GitHub Actions:**
   - Settings → Actions → General → View workflow runs

2. **Anthropic Console:**
   - Check API usage and costs
   - Monitor rate limits

3. **Costs:**
   - Claude Sonnet 4.5: ~$3 per 1M input tokens, ~$15 per 1M output tokens
   - Typical review: ~5,000-10,000 tokens
   - Estimated cost: $0.03-0.20 per review (¥0.2-1.4)

## 🔒 Security

- API key is stored as encrypted GitHub Secret
- Never commit API keys to repository
- Rotate keys periodically
- Monitor usage for anomalies

## 📚 Additional Resources

- [Anthropic API Docs](https://docs.anthropic.com/)
- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Project Coding Standards](.cursorrules)

## 🤝 Contributing

To improve the AI review:

1. Update the review prompt in `.github/workflows/ai-code-review.yml`
2. Add project-specific rules to `.cursorrules`
3. Adjust file patterns or diff size limits as needed
4. Test changes on a feature branch first

---

**Questions?** Open an issue or contact the maintainers.
