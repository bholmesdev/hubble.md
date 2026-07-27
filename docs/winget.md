# WinGet publishing

Hubble uses the package identifier `BenHolmes.Hubble.md`. The first manifest must
be submitted interactively. Later desktop releases submit updates from
`.github/workflows/desktop-release.yml`.

## First submission

On Windows:

1. Install WingetCreate:

   ```powershell
   winget install Microsoft.WingetCreate
   ```

2. Authenticate WingetCreate with GitHub:

   ```powershell
   wingetcreate token -s
   ```

3. Submit the latest x64 and arm64 installers:

   ```powershell
   wingetcreate new `
     https://github.com/bholmesdev/hubble.md/releases/download/desktop-v0.1.21/hubble_0.1.21_x64.exe `
     https://github.com/bholmesdev/hubble.md/releases/download/desktop-v0.1.21/hubble_0.1.21_arm64.exe
   ```

4. Use these values when prompted:

   - Package identifier: `BenHolmes.Hubble.md`
   - Publisher: `Ben Holmes`
   - Package name: `Hubble`
   - License: `MIT`
   - Package URL: `https://hubble.md`
   - Publisher URL: `https://bholmes.dev`
   - Installer type: `nullsoft`
   - Scope: `user`

5. Submit the generated manifests. Wait for the WinGet pull request to merge,
   then verify:

   ```powershell
   winget show --id BenHolmes.Hubble.md --exact
   ```

## Release automation

After the first manifest merges:

1. Create a classic GitHub PAT with the `public_repo` scope and add it as the
   Actions secret `WINGET_CREATE_GITHUB_TOKEN`. Fine-grained tokens are not
   supported. The account owns the WinGet fork and submission pull requests, so
   use a maintainer or dedicated release account.
2. Add the Actions variable `WINGET_SUBMIT_ENABLED` with value `true`.

Future `desktop-v*` releases wait for both Windows installers, then WingetCreate
opens an update pull request using their stable GitHub Release URLs and computed
hashes.
