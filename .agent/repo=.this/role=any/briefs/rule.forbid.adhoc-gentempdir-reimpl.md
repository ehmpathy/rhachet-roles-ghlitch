# rule.forbid.adhoc-gentempdir-reimpl

## severity: blocker

never adhoc implement what genTempDir already provides. use its clone/symlink/git options.

---

## .what

genTempDir from test-fns has built-in options:
- `clone: 'path/to/fixture'` - copy fixture contents
- `symlink: [{ at: 'dest', to: 'src' }]` - symlink files from repo root
- `git: true` - initialize as git repo with commits

do not manually mkdir, writeFile, or execSync git init when genTempDir handles it.

## .why

- genTempDir is tested and portable across OS
- adhoc implementations break in edge cases
- reduces code and maintenance burden

## .examples

### bad - adhoc implementation

```ts
const tempDir = genTempDir({ slug: 'test' });
mkdirSync(join(tempDir, '.agent'), { recursive: true });
writeFileSync(join(tempDir, '.agent/keyrack.yml'), content);
execSync('git init', { cwd: tempDir });
```

### good - use genTempDir options

```ts
const tempDir = genTempDir({
  slug: 'test',
  git: true,
  symlink: [
    { at: '.agent/keyrack.yml', to: '.agent/keyrack.yml' },
  ],
});
```

## .enforcement

adhoc reimplementation of genTempDir features = blocker
