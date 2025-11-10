## 📝 Description

<!-- Provide a brief description of the changes in this PR -->

## 🎯 Type of Change

<!-- Mark the relevant option with an "x" -->

- [ ] 🐛 Bug fix (non-breaking change which fixes an issue)
- [ ] ✨ New feature (non-breaking change which adds functionality)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] 📚 Documentation update
- [ ] ♻️ Refactoring (no functional changes, no api changes)
- [ ] 🎨 Style/UI update (formatting, renaming)
- [ ] ⚡ Performance improvement
- [ ] ✅ Test update
- [ ] 🔧 Configuration change
- [ ] 🔒 Security update

## 🔗 Related Issues

<!-- Link to related issues, e.g., "Closes #123" or "Fixes #456" -->

Closes #

## 📋 Changes Made

<!-- List the main changes made in this PR -->

-
-
-

## 🧪 Testing

<!-- Describe the tests you ran and their results -->

- [ ] Unit tests passed (`pnpm run test`)
- [ ] Linting passed (`pnpm run lint`)
- [ ] Formatting passed (`pnpm run format`)
- [ ] Manual testing completed
- [ ] Integration tests passed (if applicable)

**Test Results:**
<!-- Describe what you tested and the results -->

## 📸 Screenshots (if applicable)

<!-- Add screenshots or videos to help explain your changes -->

## ✅ Checklist

<!-- Mark completed items with an "x" -->

- [ ] My code follows the project's coding standards (see `.cursorrules` and `CLAUDE.md`)
- [ ] I have performed a self-review of my code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings or errors
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
- [ ] Any dependent changes have been merged and published
- [ ] I have checked my code and corrected any misspellings
- [ ] No hardcoded secrets or credentials in the code
- [ ] No use of `console.log` (using `Logger` instead)
- [ ] No use of `any` type (using proper TypeScript types)
- [ ] Proper error handling implemented (try-catch blocks)
- [ ] Environment variables used for configuration (no hardcoding)

## 🏗️ Architecture Compliance

<!-- Verify your changes follow the DDD architecture -->

- [ ] Changes are in the correct business domain (core/agent/wecom/sponge/analytics)
- [ ] Services follow single responsibility principle (<500 lines)
- [ ] Proper dependency injection used (no manual `new Service()`)
- [ ] Unified response format maintained
- [ ] Proper logging with `Logger` service

## 🔐 Security Considerations

<!-- Address any security implications -->

- [ ] No sensitive data exposed in logs
- [ ] Input validation implemented where needed
- [ ] No SQL injection vulnerabilities
- [ ] No XSS vulnerabilities
- [ ] API authentication/authorization handled correctly

## 📊 Performance Impact

<!-- Describe any performance implications -->

- [ ] No significant performance degradation
- [ ] Caching strategy considered (if applicable)
- [ ] Database queries optimized (if applicable)
- [ ] API response time acceptable

## 🚀 Deployment Notes

<!-- Any special deployment considerations -->

**Environment Variables:**
<!-- List any new environment variables needed -->

**Migration Steps:**
<!-- List any migration or setup steps needed -->

**Rollback Plan:**
<!-- Describe how to rollback if issues occur -->

## 📝 Additional Notes

<!-- Any additional information for reviewers -->

---

**Commit Convention:**
This PR follows [Conventional Commits](https://www.conventionalcommits.org/):
- feat: New feature
- fix: Bug fix
- refactor: Code refactoring
- docs: Documentation
- chore: Maintenance

**Auto-versioning:** When merged to `master`, the version will be automatically updated based on commit messages.
