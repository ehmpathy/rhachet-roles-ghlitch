# rule.require.blackbox-via-selflink

## severity: blocker

blackbox tests must use node_modules symlink via self-dep link:. pattern. never npm pack + npm install.

---

## .what

when a package tests itself via blackbox acceptance tests, use genTempDir's symlink option to symlink node_modules from the repo root. the package is already built locally via `"packagename": "link:."` self devDependency.

## .why

- self devdep `link:.` means package is already built and linked
- npm pack + npm install is slow, wasteful, and creates drift risk
- symlink preserves exact same build artifacts as local development
- genTempDir symlink is tested, portable, and idiomatic

## .how

```ts
const tempDir = genTempDir({
  slug: 'my-blackbox-test',
  git: true,
  symlink: [
    { at: 'node_modules', to: 'node_modules' },
    { at: '.agent/keyrack.yml', to: '.agent/keyrack.yml' },
  ],
});
```

## .forbidden

```ts
// 👎 never do this
const tarball = execSync('npm pack ...');
execSync('npm install ...');
```

## .enforcement

npm pack in blackbox test = blocker
